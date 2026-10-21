import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeEntitiesDb, entityRowsFromBlock, NEW_COLUMNS } from "./helpers/fake-entities-db.ts";

// Fase 3, passo 1: lettura dalle tabelle (public.entities) dietro l'interruttore SERVER_READ_ENTITIES (off | compare | on).
// Si prova con un finto client Supabase: off = nessuna chiamata alle tabelle; compare = risultato del blocco + differenza segnalata ([entities-compare]);
// on = risultato delle tabelle; ricostruzione dell'oggetto «data» del blocco; ricerche per id / codice / extId / payment intent; funzionamento con e senza le colonne della 0015.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const SE = await import("../src/lib/server-entities.ts");
const OD = await import("../src/lib/concierge-orgdata.ts");
const MB = await import("../src/lib/manage-booking.ts");
const SG = await import("../src/lib/server-booking-guard.ts");
const SR = await import("../src/lib/stripe-reconcile.ts");

const DATA_KEY = "spigolestay:data:v1";
const OWN = "own-1";
const ORG = "org-1";

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = Record<string, any>;
const personal = (): J => ({
  structures: [{ id: "S0", name: "Zero", order: 0 }, { id: "S1", name: "Casa", order: 1 }],
  roomTypes: [{ id: "RT1", structureId: "S1", name: "Doppia", basePrice: 100 }],
  units: [{ id: "U1", structureId: "S1", roomTypeId: "RT1", name: "1" }, { id: "U2", structureId: "S1", roomTypeId: "RT1", name: "2" }],
  bookings: [
    { id: "b-1", structureId: "S1", roomTypeId: "RT1", unitId: "U1", guestId: "G1", channel: "direct", status: "confirmed", checkIn: "2026-11-10", checkOut: "2026-11-13", code: "XEN-2026-0001", extId: "site:casa:tok1", stripePaymentIntent: "pi_1", paid: 100, total: 300, updatedAt: 5 },
    { id: "b-2", structureId: "S1", roomTypeId: "RT1", unitId: "U2", guestId: "G2", groupId: "grp1", channel: "booking", status: "cancelled", checkIn: "2026-09-01", checkOut: "2026-09-03", code: "4455667788", extId: "channex:abc", stripeExtraPayments: [{ pi: "pi_x", amount: 20 }], total: 200, updatedAt: 6 },
  ],
  guests: [{ id: "G1", fullName: "Anna Rossi", email: "Anna.Rossi@example.com", phone: "+39 333 1111111" }, { id: "G2", fullName: "Bob Verdi", email: "bob_verdi@example.com" }],
  directReviews: [{ id: "R1", structureId: "S1", rating: 5 }],
  events: [{ id: "E1", structureId: "S1", title: "Festa" }],
  rateOverrides: { "RT1|2026-11-05": 150 },
  activities: [{ id: "A1", ts: 20, text: "b" }, { id: "A2", ts: 10, text: "a" }],
  _deleted: { bookings: ["bx-1"] },
  _deletedLeads: ["email:x@y.it"],
});
const orgData = (): J => ({
  structures: [{ id: "SO", name: "Central Perk", orgId: ORG, stripeAccount: "acct_org" }],
  roomTypes: [{ id: "RTO", structureId: "SO", name: "Suite", basePrice: 200 }],
  units: [{ id: "UO", structureId: "SO", roomTypeId: "RTO", name: "A" }],
  bookings: [{ id: "bo-1", structureId: "SO", roomTypeId: "RTO", unitId: "UO", guestId: "GO1", channel: "direct", status: "confirmed", checkIn: "2026-12-01", checkOut: "2026-12-03", code: "XEN-2026-0002", extId: "site:cp:tok9", total: 400, updatedAt: 7 }],
  guests: [{ id: "GO1", fullName: "Carla Neri", email: "carla@example.com" }],
  rateOverrides: { "RTO|2026-12-01": 220 },
});

function world(opts: { missing?: string[]; extraRows?: J[]; mutateRows?: (rows: J[]) => J[]; blobOnly?: boolean } = {}) {
  SE._resetEntityFeatures();
  MB._resetFindByIdState();
  const withCols = !(opts.missing && opts.missing.length);
  let rows: J[] = [...entityRowsFromBlock({ type: "u", id: OWN }, personal(), { withNewColumns: withCols }), ...entityRowsFromBlock({ type: "o", id: ORG }, orgData(), { withNewColumns: withCols }), ...(opts.extraRows ?? [])];
  if (opts.mutateRows) rows = opts.mutateRows(rows);
  const { db, client } = makeFakeEntitiesDb({
    app_state: [{ user_id: OWN, rev: 1, data: { [DATA_KEY]: JSON.stringify(personal()), "spigolestay:threads:v1": "{}" } }],
    org_state: [{ org_id: ORG, rev: 1, data: { [DATA_KEY]: JSON.stringify(orgData()) } }],
    memberships: [{ user_id: OWN, org_id: ORG, active: true }],
    entities: rows,
  }, { missingColumns: opts.missing });
  return { db, admin: client as never };
}
const ent = (db: { log: { table: string }[] }) => db.log.filter((l) => l.table === "entities").length;
const stateReads = (db: { log: { table: string; filters: unknown[] }[] }, t: string) => db.log.filter((l) => l.table === t);

async function withMode<T>(m: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SERVER_READ_ENTITIES;
  if (m === undefined) delete process.env.SERVER_READ_ENTITIES; else process.env.SERVER_READ_ENTITIES = m;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.SERVER_READ_ENTITIES; else process.env.SERVER_READ_ENTITIES = prev; }
}
function captureLog() {
  const lines: { level: string; payload: J }[] = [];
  SE._setEntitiesLogger((level: string, line: string) => { assert.ok(line.startsWith("[entities-compare] "), "prefisso del registro"); lines.push({ level, payload: JSON.parse(line.slice("[entities-compare] ".length)) }); });
  return lines;
}
const ids = (xs: unknown[]) => (xs as J[]).map((x) => x.id).sort();
const ALL7 = ["structures", "roomTypes", "units", "bookings", "guests", "directReviews", "events"];

// ───────────────────────── interruttore ─────────────────────────
test("interruttore: solo 'compare' e 'on' (senza distinguere maiuscole) accendono; ogni altro valore = off", async () => {
  for (const [v, want] of [[undefined, "off"], ["", "off"], ["off", "off"], ["boh", "off"], ["1", "off"], ["true", "off"], ["on", "on"], [" ON ", "on"], ["Compare", "compare"]] as const) {
    assert.equal(await withMode(v, async () => SE.entitiesReadMode()), want, String(v));
  }
});

test("off (default): nessuna chiamata alle tabelle da NESSUN punto migrato", async () => {
  const { db, admin } = world();
  const lines = captureLog();
  await withMode(undefined, async () => {
    await OD.loadOrgDatas(admin, OWN);
    await OD.loadOrgData(admin, ORG);
    await OD.loadTenantData(admin, OWN);
    assert.equal((await MB.findBookingStoreById(admin, "bo-1"))?.keyVal, ORG);
    await SG.findOwnerStructure(admin, OWN, "SO");
    await SG.loadOwnerStructureData(admin, OWN, "S1");
    await SG.loadOrgDataParts(admin, OWN);
    await SR.reconcileCharge(admin as never, { amount: 10000, amount_refunded: 4000 }, "pi_1", false);
    await SE.entitiesShadow("x", 1, async () => 2);
  });
  assert.equal(ent(db), 0, "off non deve toccare public.entities");
  assert.equal(lines.length, 0, "off non scrive nel registro");
});

// ───────────────────────── loadOrgDatas: off / compare / on ─────────────────────────
test("compare: restituisce il risultato del BLOCCO e segnala la differenza con le tabelle", async () => {
  // le tabelle hanno perso la prenotazione bo-1 e hanno un'altra email per l'ospite GO1
  const { db, admin } = world({ mutateRows: (rows) => rows.filter((r) => r.id !== "bo-1").map((r) => (r.id === "GO1" ? { ...r, data: { ...r.data, email: "altra@example.com" } } : r)) });
  const lines = captureLog();
  const got = await withMode("compare", () => OD.loadOrgDatas(admin, OWN));
  assert.deepEqual(ids(got[0].bookings as unknown[]), ["bo-1"], "il risultato e' quello del blocco");
  assert.ok(ent(db) > 0, "ha letto anche le tabelle");
  const d = lines.find((l) => l.payload.label === "loadOrgDatas");
  assert.ok(d, "differenza registrata");
  assert.equal(d.level, "warn");
  assert.equal(d.payload.result, "diff");
  assert.deepEqual(d.payload.colls.bookings.onlyBlock, ["bo-1"]);
  assert.deepEqual(d.payload.colls.guests.changed, ["GO1"]);
  assert.ok(d.payload.colls.guests.fields.includes("email"));
});

test("compare: dati uguali -> una riga 'ok' (al massimo una ogni 10 minuti per punto), risultato del blocco", async () => {
  const { admin } = world();
  const lines = captureLog();
  await withMode("compare", async () => { await OD.loadOrgDatas(admin, OWN); await OD.loadOrgDatas(admin, OWN); });
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].level, lines[0].payload.label, lines[0].payload.result], ["info", "loadOrgDatas", "ok"]);
});

test("compare: errore di lettura delle tabelle = registrato, il risultato del blocco arriva comunque", async () => {
  const { db, admin } = world();
  db.failEntities = "connessione persa";
  const lines = captureLog();
  const got = await withMode("compare", () => OD.loadOrgDatas(admin, OWN));
  assert.equal(got.length, 1);
  assert.equal(lines[0].payload.result, "error");
  assert.match(String(lines[0].payload.message), /connessione persa/);
});

test("on: restituisce il risultato delle TABELLE (e non legge il blocco delle organizzazioni)", async () => {
  const extra = { owner_type: "o", owner_id: ORG, kind: "bookings", id: "bo-solo-tabella", structure_id: "SO", data: { id: "bo-solo-tabella", structureId: "SO", checkIn: "2027-01-01", checkOut: "2027-01-02", status: "confirmed" }, check_in: "2027-01-01", check_out: "2027-01-02", status: "confirmed", updated_ms: 1 };
  const { db, admin } = world({ extraRows: [extra] });
  const got = await withMode("on", () => OD.loadOrgDatas(admin, OWN));
  assert.deepEqual(ids(got[0].bookings as unknown[]), ["bo-1", "bo-solo-tabella"]);
  assert.equal(stateReads(db, "org_state").length, 0, "il blocco org non si legge");
  assert.ok(stateReads(db, "memberships").length > 0);
  // mergeOrgData funziona sul risultato come sul blocco
  const merged = OD.mergeOrgData(personal(), got);
  assert.deepEqual(ids(merged.bookings as unknown[]), ["b-1", "b-2", "bo-1", "bo-solo-tabella"]);
});

test("on: se le tabelle vanno in errore si ripiega sul blocco e lo si segnala", async () => {
  const { db, admin } = world();
  db.failEntities = "tabella non raggiungibile";
  const lines = captureLog();
  const got = await withMode("on", () => OD.loadOrgDatas(admin, OWN));
  assert.deepEqual(ids(got[0].bookings as unknown[]), ["bo-1"]);
  assert.equal(lines[0].payload.result, "fallback_to_block");
});

test("loadTenantData: on = personale + organizzazioni dalle tabelle, senza scaricare i blocchi", async () => {
  const { db, admin } = world();
  const fromBlock = await withMode("off", () => OD.loadTenantData(admin, OWN));
  const reads0 = stateReads(db, "app_state").length;
  assert.ok(reads0 > 0);
  const fromTables = await withMode("on", () => OD.loadTenantData(admin, OWN));
  assert.equal(stateReads(db, "app_state").length, reads0, "con on il blocco personale non viene letto");
  assert.equal(SE.diffBlockParts([fromBlock], [fromTables], OD ? ["structures", "roomTypes", "units", "bookings", "guests"] : []), null);
  assert.deepEqual(ids(fromTables.structures as unknown[]), ["S0", "S1", "SO"]);
});

// ───────────────────────── ricostruzione dell'oggetto «data» ─────────────────────────
test("buildBlockData: ricostruisce le sette collezioni equivalenti al blocco (anche PRIMA della 0015)", async () => {
  const { admin } = world({ missing: NEW_COLUMNS });
  const built = await SE.buildBlockData(admin, { type: "u", id: OWN });
  assert.equal(SE.diffBlockParts([personal()], [built], ALL7), null);
  assert.deepEqual((built.structures as J[]).map((s) => s.id), ["S0", "S1"], "strutture nell'ordine scelto dall'utente (campo order)");
  assert.ok(!("rateOverrides" in built), "senza richiesta non c'e' rateOverrides");
});

test("buildBlockData: prima della 0015 i prezzi forzati vengono dal blocco, i campi extra non ci sono", async () => {
  const { admin } = world({ missing: NEW_COLUMNS });
  const built = await SE.buildBlockData(admin, { type: "u", id: OWN }, { kinds: ["bookings"], extras: true });
  assert.deepEqual(Object.keys(built), ["bookings"]);
  const withRates = await SE.buildBlockData(admin, { type: "u", id: OWN }, { kinds: ["roomTypes"], rateOverrides: true });
  assert.deepEqual(withRates.rateOverrides, { "RT1|2026-11-05": 150 });
});

test("buildBlockData con la 0015: ricostruisce anche prezzi forzati, attivita' e lapidi", async () => {
  const extraRows: J[] = [
    { owner_type: "u", owner_id: OWN, kind: "rates", id: "RT1|2026-11-05", data: 150 },
    { owner_type: "u", owner_id: OWN, kind: "activities", id: "A1", data: { id: "A1", ts: 20, text: "b" } },
    { owner_type: "u", owner_id: OWN, kind: "activities", id: "A2", data: { id: "A2", ts: 10, text: "a" } },
    { owner_type: "u", owner_id: OWN, kind: "tombs", id: "bookings|bx-1", data: {} },
    { owner_type: "u", owner_id: OWN, kind: "leadtombs", id: "email:x@y.it", data: {} },
  ];
  const { admin } = world({ extraRows });
  const built = await SE.buildBlockData(admin, { type: "u", id: OWN }, { extras: true });
  const orig = personal();
  assert.equal(SE.diffBlockParts([orig], [built], ALL7, { rates: true }), null);
  assert.deepEqual(built.rateOverrides, orig.rateOverrides);
  assert.deepEqual(built._deleted, orig._deleted, "lapidi");
  assert.deepEqual(built._deletedLeads, orig._deletedLeads);
  assert.deepEqual((built.activities as J[]).map((a) => a.id), ["A2", "A1"], "attivita' per ts crescente");
});

test("la lettura va a pagine da 1000 righe (PostgREST taglia a 1000)", async () => {
  const many: J[] = Array.from({ length: 2500 }, (_, i) => ({ owner_type: "u", owner_id: OWN, kind: "guests", id: "g" + String(i).padStart(5, "0"), data: { id: "g" + i }, structure_id: null }));
  const { db, admin } = world({ extraRows: many });
  const guests = await SE.readGuests(admin, { type: "u", id: OWN });
  assert.equal(guests.length, 2502);
  assert.equal(new Set(guests.map((g) => g.id)).size, 2502);
  assert.ok(db.log.filter((l) => l.range).length >= 3);
});

test("finestra di prenotazioni: sovrapposizione inclusiva con [from, to], struttura, stato; ospiti per id", async () => {
  const { admin } = world();
  const u = { type: "u" as const, id: OWN };
  assert.deepEqual(ids(await SE.readBookings(admin, u, { from: "2026-11-01", to: "2026-11-30" })), ["b-1"]);
  assert.deepEqual(ids(await SE.readBookings(admin, u, { from: "2026-11-13", to: "2026-11-20" })), ["b-1"], "check_out == from conta (inclusivo)");
  assert.deepEqual(ids(await SE.readBookings(admin, u, { from: "2026-11-14" })), []);
  assert.deepEqual(ids(await SE.readBookings(admin, u, { statuses: ["cancelled"] })), ["b-2"]);
  assert.deepEqual(ids(await SE.readBookings(admin, u, { structureId: "NO" })), []);
  assert.deepEqual(ids(await SE.readGuestsByIds(admin, u, ["G2", "GO1", "nope"])), ["G2"], "solo i suoi ospiti");
  assert.deepEqual(await SE.readGuestsByIds(admin, u, []), []);
  assert.deepEqual(ids(await SE.readDirectReviews(admin, u)), ["R1"]);
  assert.deepEqual(ids(await SE.readEvents(admin, u)), ["E1"]);
});

// ───────────────────────── colonne della 0015: prima si ripiega su data->>campo, dopo si usano ─────────────────────────
test("senza le colonne nuove: filtri su data->>campo vincolati al kind; con le colonne: colonne indicizzate (rilevate UNA volta)", async () => {
  const u = { type: "u" as const, id: OWN };
  const before = world({ missing: NEW_COLUMNS });
  assert.deepEqual(ids(await SE.readBookings(before.admin, u, { unitId: "U1" })), ["b-1"]);
  assert.deepEqual(ids(await SE.readBookings(before.admin, u, { guestId: "G2" })), ["b-2"]);
  assert.deepEqual(ids(await SE.readBookings(before.admin, u, { groupId: "grp1" })), ["b-2"]);
  assert.deepEqual(ids((await SE.findBookingsByOtaCode(before.admin, "4455667788")).map((h) => h.booking)), ["b-2"]);
  const cols = before.db.log.filter((l) => l.table === "entities").flatMap((l) => l.filters.map((f) => f.col));
  assert.ok(cols.includes("data->>unitId") && cols.includes("data->>guestId") && cols.includes("data->>groupId") && cols.includes("data->>code"));
  assert.ok(!cols.includes("unit_id") && !cols.includes("ota_code"));
  assert.equal(before.db.log.filter((l) => l.cols === "ota_code").length, 1, "una sola sonda per processo");

  const after = world();
  assert.deepEqual(ids(await SE.readBookings(after.admin, u, { unitId: "U1" })), ["b-1"]);
  assert.deepEqual(ids(await SE.readBookings(after.admin, u, { groupId: "grp1" })), ["b-2"]);
  assert.deepEqual(ids((await SE.findBookingsByOtaCode(after.admin, "4455667788")).map((h) => h.booking)), ["b-2"]);
  const cols2 = after.db.log.filter((l) => l.table === "entities").flatMap((l) => l.filters.map((f) => f.col));
  assert.ok(cols2.includes("unit_id") && cols2.includes("group_id") && cols2.includes("ota_code"));
  assert.ok(!cols2.includes("data->>unitId") && !cols2.includes("data->>code"));
  assert.equal(after.db.log.filter((l) => l.cols === "ota_code").length, 1, "una sola sonda per processo");
});

test("una sonda con errore NON definitivo (rete) non viene memorizzata: si ritenta", async () => {
  const w = world();
  w.db.failEntities = "rete";
  assert.deepEqual(await SE.entityFeatures(w.admin), { ota_code: false, unit_id: false, guest_id: false, group_id: false });
  w.db.failEntities = undefined;
  assert.equal((await SE.entityFeatures(w.admin)).ota_code, true);
});

// ───────────────────────── ricerche di una prenotazione ─────────────────────────
test("ricerca per id / codice Xenora / codice OTA / extId / payment intent", async () => {
  const { admin } = world();
  const owners = (hs: { owner: { type: string; id: string } }[]) => hs.map((h) => h.owner.type + ":" + h.owner.id);
  assert.deepEqual(owners(await SE.findBookingsById(admin, "bo-1")), ["o:" + ORG]);
  assert.deepEqual(await SE.findBookingsById(admin, "inesistente"), []);
  assert.deepEqual(await SE.findBookingsById(admin, ""), []);
  assert.deepEqual(owners(await SE.findBookingsByXenoraCode(admin, "xen-2026-0002")), ["o:" + ORG], "senza distinguere maiuscole");
  assert.deepEqual(owners(await SE.findBookingsByXenoraCode(admin, "XEN-2026-0002", { structureId: "S1" })), []);
  assert.deepEqual(ids((await SE.findBookingsByOtaCode(admin, "4455667788", { structureId: "S1" })).map((h) => h.booking)), ["b-2"]);
  assert.deepEqual(ids((await SE.findBookingsByExtId(admin, "site:casa:tok1")).map((h) => h.booking)), ["b-1"]);
  assert.deepEqual(ids((await SE.findBookingsByPaymentIntent(admin, "pi_1")).map((h) => h.booking)), ["b-1"]);
  assert.deepEqual(ids((await SE.findBookingsByPaymentIntent(admin, "pi_x")).map((h) => h.booking)), ["b-2"], "anche tra i pagamenti successivi");
  assert.deepEqual(await SE.findBookingsByPaymentIntent(admin, "pi_boh"), []);
});

test("stesso id in organizzazione e personale: l'organizzazione viene prima (come nel blocco)", async () => {
  const dup = { owner_type: "u", owner_id: OWN, kind: "bookings", id: "bo-1", data: { id: "bo-1" }, structure_id: "SO" };
  const { admin } = world({ extraRows: [dup] });
  assert.deepEqual((await SE.findBookingsById(admin, "bo-1")).map((h) => h.owner.type), ["o", "u"]);
});

test("findGuestsByContact: email senza distinguere maiuscole, i caratteri jolly '_' e '%' non fanno da jolly", async () => {
  const { admin } = world();
  const u = { type: "u" as const, id: OWN };
  assert.deepEqual(ids(await SE.findGuestsByContact(admin, u, { email: "anna.rossi@EXAMPLE.com" })), ["G1"]);
  assert.deepEqual(ids(await SE.findGuestsByContact(admin, u, { email: "bob_verdi@example.com" })), ["G2"]);
  assert.deepEqual(ids(await SE.findGuestsByContact(admin, u, { email: "bobXverdi@example.com" })), [], "'_' non e' un jolly");
  assert.deepEqual(ids(await SE.findGuestsByContact(admin, u, { phone: "+39 333 1111111" })), ["G1"]);
  assert.deepEqual(await SE.findGuestsByContact(admin, u, {}), []);
});

// ───────────────────────── findBookingStoreById ─────────────────────────
test("findBookingStoreById: off = scansione dei blocchi come sempre; on = una ricerca per id + la sola riga del blocco", async () => {
  const off = world();
  const a = await withMode("off", () => MB.findBookingStoreById(off.admin, "b-1"));
  assert.equal(a?.keyVal, OWN);
  assert.ok(off.db.log.some((l) => l.table === "app_state" && l.filters.length === 0), "off scorre l'elenco dei tenant");

  const on = world();
  const b = await withMode("on", () => MB.findBookingStoreById(on.admin, "b-1"));
  assert.equal(b?.keyVal, OWN);
  assert.equal(b?.rev, 1);
  assert.equal(JSON.stringify(b?.booking), JSON.stringify(a?.booking));
  assert.ok(on.db.log.filter((l) => l.table !== "entities").every((l) => l.filters.length > 0), "nessuna scansione di tutte le righe");
  assert.equal(stateReads(on.db, "app_state").length + stateReads(on.db, "org_state").length, 1, "legge solo la riga giusta");

  const org = world();
  const c = await withMode("on", () => MB.findBookingStoreById(org.admin, "bo-1"));
  assert.deepEqual([c?.table, c?.keyCol, c?.keyVal], ["org_state", "org_id", ORG]);
  assert.equal(await withMode("on", () => MB.findBookingStoreById(org.admin, "inesistente")), null);
});

test("findBookingStoreById: compare restituisce la scansione e segnala se le tabelle indicano altro", async () => {
  const w = world({ mutateRows: (rows) => rows.filter((r) => r.id !== "b-1") });
  const lines = captureLog();
  const s = await withMode("compare", () => MB.findBookingStoreById(w.admin, "b-1"));
  assert.equal(s?.keyVal, OWN, "risultato del blocco");
  assert.equal(lines[0].payload.label, "findBookingStoreById");
  assert.equal(lines[0].payload.result, "diff");

  const ok = world();
  const lines2 = captureLog();
  await withMode("compare", () => MB.findBookingStoreById(ok.admin, "bo-1"));
  assert.equal(lines2[0].payload.result, "ok");
});

test("findBookingStoreById: on mantiene il tetto alle ricerche fallite e la cache", async () => {
  const w = world();
  await withMode("on", async () => {
    assert.ok(await MB.findBookingStoreById(w.admin, "b-1"));
    for (let i = 0; i < 60; i++) assert.equal(await MB.findBookingStoreById(w.admin, "x" + i), null);
    const before = w.db.log.length;
    assert.equal(await MB.findBookingStoreById(w.admin, "ancora-inventato"), null);
    assert.equal(w.db.log.length, before, "oltre il tetto non si interroga piu' nulla");
    assert.ok(await MB.findBookingStoreById(w.admin, "b-1"), "l'id vero gia' trovato funziona ancora");
  });
});

// ───────────────────────── stripe-reconcile: ultima risorsa senza scansione ─────────────────────────
test("reconcileCharge: senza metadata, on trova il proprietario dal payment intent (niente scansione) e aggiorna il blocco", async () => {
  const w = world();
  const r = await withMode("on", () => SR.reconcileCharge(w.admin as never, { amount: 30000, amount_refunded: 10000 }, "pi_1", false));
  assert.equal(r, "ok");
  assert.ok(w.db.log.filter((l) => l.table !== "entities" && l.table !== "memberships").every((l) => l.op === "update" || l.filters.length > 0), "nessuna scansione di tutte le righe");
  const row = (w.db.tables.app_state[0].data as J)[DATA_KEY];
  assert.equal(JSON.parse(row).bookings.find((b: J) => b.id === "b-1").paid, 0, "rimborso parziale scalato dal pagato");
  assert.equal(w.db.tables.app_state[0].rev, 2);
});

test("reconcileCharge: off scandisce come sempre; compare scandisce e confronta con le tabelle", async () => {
  const off = world();
  assert.equal(await withMode("off", () => SR.reconcileCharge(off.admin as never, { amount: 30000, amount_refunded: 10000 }, "pi_1", false)), "ok");
  assert.ok(off.db.log.some((l) => l.table === "app_state" && l.filters.length === 0), "off: elenco completo dei tenant");
  assert.equal(ent(off.db), 0);

  const cmp = world();
  const lines = captureLog();
  assert.equal(await withMode("compare", () => SR.reconcileCharge(cmp.admin as never, { amount: 30000, amount_refunded: 10000 }, "pi_1", false)), "ok");
  assert.ok(cmp.db.log.some((l) => l.table === "app_state" && l.filters.length === 0), "compare: risultato dalla scansione");
  assert.equal(lines[0].payload.label, "stripe-reconcile.lastResort");
  assert.equal(lines[0].payload.result, "ok");

  const bad = world({ mutateRows: (rows) => rows.filter((r) => r.id !== "b-1") });
  const lines2 = captureLog();
  await withMode("compare", () => SR.reconcileCharge(bad.admin as never, { amount: 30000, amount_refunded: 10000 }, "pi_1", false));
  assert.equal(lines2[0].payload.result, "diff");
});

// ───────────────────────── server-booking-guard ─────────────────────────
test("server-booking-guard: on = stessi dati del blocco (struttura personale, struttura condivisa, parti org)", async () => {
  const w = world();
  for (const sid of ["S1", "SO"]) {
    const fromBlock = await withMode("off", () => SG.loadOwnerStructureData(w.admin, OWN, sid));
    const fromTables = await withMode("on", () => SG.loadOwnerStructureData(w.admin, OWN, sid));
    assert.ok(fromBlock && fromTables, sid);
    assert.equal(SE.diffBlockParts([fromBlock as never], [fromTables as never], ["roomTypes", "units", "bookings"], { rates: true }), null, sid);
  }
  assert.deepEqual((await withMode("on", () => SG.loadOwnerStructureData(w.admin, OWN, "SO")))?.rateOverrides, { "RTO|2026-12-01": 220 }, "prezzi forzati dell'organizzazione (dal blocco finche' la 0015 non c'e')");
  assert.equal(await withMode("on", () => SG.loadOwnerStructureData(w.admin, OWN, "NO")), null);
  assert.equal(await withMode("on", () => SG.loadOwnerStructureData(w.admin, "sconosciuto", "S1")), null);

  const parts = await withMode("on", () => SG.loadOrgDataParts(w.admin, OWN));
  const partsBlock = await withMode("off", () => SG.loadOrgDataParts(w.admin, OWN));
  assert.equal(SE.diffBlockParts(partsBlock, parts, ["structures", "roomTypes", "units", "bookings"], { rates: true }), null);
  const merged = SG.mergeOwnerData([personal(), ...parts]);
  assert.deepEqual(ids(merged.structures), ["S0", "S1", "SO"]);
});

test("server-booking-guard: findOwnerStructure sceglie come il blocco (conto Stripe dell'org prima del personale)", async () => {
  const w = world();
  const a = await withMode("off", () => SG.findOwnerStructure(w.admin, OWN, "SO"));
  const b = await withMode("on", () => SG.findOwnerStructure(w.admin, OWN, "SO"));
  assert.equal(b?.stripeAccount, "acct_org");
  assert.deepEqual(a, b);
  assert.deepEqual(await withMode("on", () => SG.findOwnerStructure(w.admin, OWN, "S1")), personal().structures[1]);
  assert.equal(await withMode("on", () => SG.findOwnerStructure(w.admin, OWN, "NO")), null);
  // personale con conto Stripe e org senza: vince il personale con stripeAccount
  const w2 = world({ mutateRows: (rows) => rows.map((r) => (r.id === "SO" ? { ...r, data: { ...r.data, stripeAccount: undefined } } : r)).concat([{ owner_type: "u", owner_id: OWN, kind: "structures", id: "SO", data: { id: "SO", stripeAccount: "acct_pers" }, structure_id: "SO" }]) });
  assert.equal((await withMode("on", () => SG.findOwnerStructure(w2.admin, OWN, "SO")))?.stripeAccount, "acct_pers");
});

test("server-booking-guard: compare segnala la camera mancante nelle tabelle e restituisce il blocco", async () => {
  const w = world({ mutateRows: (rows) => rows.filter((r) => r.id !== "U2") });
  const lines = captureLog();
  const got = await withMode("compare", () => SG.loadOwnerStructureData(w.admin, OWN, "S1"));
  assert.equal(got?.units.length, 2, "risultato del blocco");
  assert.equal(lines[0].payload.label, "loadOwnerStructureData");
  assert.deepEqual(lines[0].payload.colls.units.onlyBlock, ["U2"]);
});

// ───────────────────────── solo lettura accanto a una scrittura (public-lead) ─────────────────────────
test("entitiesShadow: solo in compare confronta e registra; off e on non toccano le tabelle", async () => {
  const w = world();
  const lookup = (email: string) => async () => (await SE.findGuestsByContact(w.admin, { type: "u", id: OWN }, { email })).map((g) => String(g.id))[0] ?? null;
  const lines = captureLog();
  await withMode("off", () => SE.entitiesShadow("public-lead.guestLookup", "G1", lookup("anna.rossi@example.com")));
  await withMode("on", () => SE.entitiesShadow("public-lead.guestLookup", "G1", lookup("anna.rossi@example.com")));
  assert.equal(ent(w.db), 0);
  await withMode("compare", () => SE.entitiesShadow("public-lead.guestLookup", "G1", lookup("anna.rossi@example.com")));
  assert.equal(lines[0].payload.result, "ok");
  await withMode("compare", () => SE.entitiesShadow("public-lead.guestLookup2", "G2", lookup("anna.rossi@example.com")));
  assert.equal(lines[1].payload.result, "diff");
});
