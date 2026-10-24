import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeEntitiesDb, entityRowsFromBlock, type FakeEntitiesDb } from "./helpers/fake-entities-db.ts";

// Fase 3, store dalle tabelle (docs/FASE3-STORE-DA-TABELLE.md): quando per un proprietario un tipo (bookings, structures, guests, ...) ha autorita' 'table' il blocco
// non contiene piu' quella collezione. findBookingStore* (manage-booking.ts) e i caricatori dei lettori (loadOrgData, loadOrgDatas, loadTenantData, server-booking-guard)
// devono ricomporre i dati dalle tabelle SOLO in quel caso. Con un finto client Supabase si prova che:
//  (a) interruttore SERVER_WRITE_ENTITIES spento, tabella entity_authority assente, nessuna riga, autorita' 'blob' o errore nel leggerla => identico a oggi
//      (nessuna lettura di public.entities; interruttore spento = nemmeno una chiamata a entity_authority);
//  (b) autorita' 'table' => lo store/i dati vengono dalle tabelle (anche misti: un tipo 'table' e gli altri dal blocco), per personale e organizzazioni;
//  (c) tabelle illeggibili con autorita' confermata => mai un ripiego sul blocco vuoto (store non trovato / org saltata) e nessuna eccezione;
//  (d) le collezioni lette dalle tabelle non finiscono MAI nel blocco (percorso di scrittura del blocco con store misto).
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const SE = await import("../src/lib/server-entities.ts");
const W = await import("../src/lib/server-entities-write.ts");
const ST = await import("../src/lib/server-entities-store.ts");
const MB = await import("../src/lib/manage-booking.ts");
const OD = await import("../src/lib/concierge-orgdata.ts");
const BG = await import("../src/lib/server-booking-guard.ts");
const SR = await import("../src/lib/stripe-reconcile.ts");
const AT = await import("../src/lib/auto-trace.ts");

const DATA_KEY = "spigolestay:data:v1";
const OWN = "own-1";
const ORG = "org-1";
const SLUG = "casa";
/* eslint-disable @typescript-eslint/no-explicit-any */
type J = Record<string, any>;

const personal = (): J => ({
  structures: [{ id: "S1", name: "Casa", order: 0, stripeAccount: "acct_pers" }],
  roomTypes: [{ id: "RT1", structureId: "S1", name: "Doppia" }],
  units: [{ id: "U1", structureId: "S1", roomTypeId: "RT1", name: "1" }, { id: "U2", structureId: "S1", roomTypeId: "RT1", name: "2" }],
  bookings: [
    { id: "b-1", structureId: "S1", roomTypeId: "RT1", unitId: "U1", guestId: "G1", channel: "direct", status: "confirmed", checkIn: "2026-11-10", checkOut: "2026-11-13", paid: 100, total: 300, updatedAt: 1000 },
    { id: "g-1", structureId: "S1", roomTypeId: "RT1", unitId: "U2", groupId: "grp1", guestId: "G1", channel: "direct", status: "confirmed", checkIn: "2026-12-01", checkOut: "2026-12-03", total: 200, paid: 0, updatedAt: 2000 },
    { id: "g-2", structureId: "S1", roomTypeId: "RT1", unitId: "U1", groupId: "grp1", guestId: "G1", channel: "direct", status: "confirmed", checkIn: "2026-12-01", checkOut: "2026-12-03", total: 200, paid: 0, updatedAt: 3000 },
  ],
  guests: [{ id: "G1", fullName: "Anna Rossi" }],
});
const orgData = (): J => ({
  structures: [{ id: "SO", name: "Central Perk", orgId: ORG, stripeAccount: "acct_org" }],
  roomTypes: [{ id: "RTO", structureId: "SO", name: "Suite" }],
  units: [{ id: "UO", structureId: "SO", roomTypeId: "RTO", name: "A" }],
  bookings: [{ id: "bo-1", structureId: "SO", roomTypeId: "RTO", unitId: "UO", guestId: "GO1", channel: "direct", status: "confirmed", checkIn: "2026-12-10", checkOut: "2026-12-12", total: 400, paid: 0, updatedAt: 7000 }],
  guests: [{ id: "GO1", fullName: "Carla Neri" }],
});

interface WorldOpts {
  /** Tipi con autorita' 'table' per il personale / per l'organizzazione (di default il blocco di quei tipi viene svuotato, come dopo il passaggio). */
  u?: string[]; o?: string[];
  /** Righe di entity_authority aggiuntive o diverse (sostituiscono quelle generate da u/o). */
  authRows?: J[];
  authTable?: boolean;
  authError?: { code?: string; message: string } | "throws";
  /** true = il blocco conserva ancora la vecchia copia anche per i tipi 'table' (prima della pulizia). */
  keepBlock?: boolean;
  failEntities?: string;
}
function world(opts: WorldOpts = {}) {
  W._resetWriteState();
  SE._resetEntityFeatures();
  MB._resetFindByIdState();
  const p = personal(), o = orgData();
  const rows = [...entityRowsFromBlock({ type: "u", id: OWN }, p), ...entityRowsFromBlock({ type: "o", id: ORG }, o)];
  const emptied = (d: J, kinds: string[] = []) => { const c = structuredClone(d); if (!opts.keepBlock) for (const k of kinds) c[k] = []; return c; };
  const pb = emptied(p, opts.u), ob = emptied(o, opts.o);
  const tables: Record<string, J[]> = {
    entities: rows,
    app_state: [{ user_id: OWN, rev: 1, data: { [DATA_KEY]: JSON.stringify(pb), "spigolestay:threads:v1": "{}" } }],
    org_state: [{ org_id: ORG, rev: 1, data: { [DATA_KEY]: JSON.stringify(ob) } }],
    memberships: [{ user_id: OWN, org_id: ORG, active: true }],
    public_sites: [{ slug: SLUG, user_id: OWN, structure_id: "S1" }],
  };
  if (opts.authTable !== false) {
    tables.entity_authority = opts.authRows ?? [
      ...(opts.u ?? []).map((k) => ({ owner_type: "u", owner_id: OWN, kind: k, authority: "table" })),
      ...(opts.o ?? []).map((k) => ({ owner_type: "o", owner_id: ORG, kind: k, authority: "table" })),
    ];
  }
  const { db, client } = makeFakeEntitiesDb(tables);
  if (opts.failEntities) db.failEntities = opts.failEntities;
  const base = client as { from: (t: string) => any };
  const log: string[] = [];
  const admin = {
    from(table: string) {
      log.push(table);
      if (table === "entity_authority" && opts.authTable === false) {
        const chain: any = { select: () => chain, eq: () => chain, in: () => chain, maybeSingle: async () => ({ data: null, error: { code: "42P01", message: 'relation "public.entity_authority" does not exist' } }), then: (res: any) => Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "public.entity_authority" does not exist' } }).then(res) };
        return chain;
      }
      if (table === "entity_authority" && opts.authError) {
        const e = opts.authError;
        const fail = () => { if (e === "throws") throw new Error("rete caduta"); return { data: null, error: e }; };
        const chain: any = { select: () => chain, eq: () => chain, in: () => chain, maybeSingle: async () => fail(), then: (res: any, rej: any) => { try { return Promise.resolve(fail()).then(res, rej); } catch (x) { return Promise.reject(x).then(res, rej); } } };
        return chain;
      }
      return base.from(table);
    },
  };
  return { db, admin: admin as never, log };
}
async function withEnv<T>(env: { w?: string; r?: string }, fn: () => Promise<T>): Promise<T> {
  const prev = { w: process.env.SERVER_WRITE_ENTITIES, r: process.env.SERVER_READ_ENTITIES };
  const set = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  set("SERVER_WRITE_ENTITIES", env.w); set("SERVER_READ_ENTITIES", env.r);
  try { return await fn(); } finally { set("SERVER_WRITE_ENTITIES", prev.w); set("SERVER_READ_ENTITIES", prev.r); }
}
const on = <T,>(fn: () => Promise<T>) => withEnv({ w: "on" }, fn);
const ent = (db: FakeEntitiesDb) => db.log.filter((l) => l.table === "entities").length;
const authCalls = (log: string[]) => log.filter((t) => t === "entity_authority").length;
const row = (db: FakeEntitiesDb, id: string, ot = "u"): J => db.tables.entities.find((r) => r.id === id && r.owner_type === ot) as J;
const blobOf = (db: FakeEntitiesDb, t: "app_state" | "org_state" = "app_state"): J => JSON.parse((db.tables[t][0].data as J)[DATA_KEY]);
const blobUpdates = (db: FakeEntitiesDb) => db.log.filter((l) => l.op === "update" && (l.table === "app_state" || l.table === "org_state")).length;
const rowUpdates = (db: FakeEntitiesDb) => db.log.filter((l) => l.op === "update" && l.table === "entities").length;
const ids = (xs: J[]) => xs.map((x) => x.id).sort();
const mute = (fn: () => Promise<void>) => { const orig = console.error; console.error = () => {}; return fn().finally(() => { console.error = orig; }); };

const TABLE_ALL = ["bookings", "structures", "guests"];

// ───────────────────────── (a) identico a oggi ─────────────────────────
test("readTableKinds: interruttore spento = nessuna chiamata; riga assente/blob/errore/tabella assente = []", async () => {
  const w = world({ u: TABLE_ALL });
  assert.deepEqual(await withEnv({}, () => W.readTableKinds(w.admin, "u", OWN, ["bookings", "structures"])), []);
  assert.equal(w.log.length, 0, "interruttore spento: nessuna tabella toccata");
  assert.deepEqual((await on(() => W.readTableKinds(w.admin, "u", OWN, ["bookings", "units", "structures"]))).sort(), ["bookings", "structures"]);
  assert.equal(authCalls(w.log), 1, "una sola richiesta per tutti i tipi");
  assert.deepEqual(await on(() => W.readTableKinds(w.admin, "o", ORG, ["bookings"])), [], "altro proprietario");
  assert.deepEqual(await on(() => W.readTableKinds(world({ authRows: [{ owner_type: "u", owner_id: OWN, kind: "bookings", authority: "blob" }] }).admin, "u", OWN, ["bookings"])), []);
  assert.deepEqual(await on(() => W.readTableKinds(world({ authTable: false }).admin, "u", OWN, ["bookings"])), []);
  assert.deepEqual(await on(() => W.readTableKinds(world({ authError: { code: "XX000", message: "boom" } }).admin, "u", OWN, ["bookings"])), []);
  assert.deepEqual(await on(() => W.readTableKinds(world({ authError: "throws" }).admin, "u", OWN, ["bookings"])), []);
});

test("senza passare a 'table' lo store e' identico a oggi, a interruttore acceso o spento, e public.entities non e' mai letta", async () => {
  for (const [label, env, o] of [
    ["spento", {}, { u: TABLE_ALL, keepBlock: true }],
    ["acceso, nessuna riga", { w: "on" }, {}],
    ["acceso, blob", { w: "on" }, { authRows: [{ owner_type: "u", owner_id: OWN, kind: "bookings", authority: "blob" }] }],
    ["acceso, tabella assente", { w: "on" }, { authTable: false }],
    ["acceso, errore", { w: "on" }, { authError: { code: "XX000", message: "boom" } }],
    ["acceso, eccezione", { w: "on" }, { authError: "throws" as const }],
  ] as const) {
    const w = world(o as never);
    const s = await withEnv(env, () => MB.findBookingStore(w.admin, SLUG, "g-1"));
    assert.ok(s, label);
    assert.equal(s!.booking.id, "g-1", label);
    assert.equal(s!.structure?.name, "Casa", label);
    assert.equal(s!.guest?.fullName, "Anna Rossi", label);
    assert.equal(s!.tableKinds, undefined, label);
    assert.equal(s!.blockData, undefined, label);
    assert.deepEqual(s!.data, blobOf(w.db), label + ": data e' il blocco com'e'");
    assert.equal(ent(w.db), 0, label + ": public.entities non letta");
    if (!env.w) assert.equal(authCalls(w.log), 0, label + ": interruttore spento = nemmeno entity_authority");
  }
});

test("interruttore spento: con autorita' 'table' e blocco svuotato lo store non si trova (comportamento di oggi), senza toccare le tabelle", async () => {
  const w = world({ u: TABLE_ALL });
  assert.equal(await withEnv({}, () => MB.findBookingStore(w.admin, SLUG, "g-1")), null);
  assert.equal(await withEnv({}, () => MB.findBookingStoreById(w.admin, "g-1")), null);
  assert.equal(await withEnv({}, () => MB.findBookingStoreForTenant(w.admin, OWN, "g-1")), null);
  assert.equal(w.log.filter((t) => t === "entity_authority" || t === "entities").length, 0);
});

test("findBookingStoreById, interruttore acceso ma nessun proprietario 'table': stessa risposta di oggi (trovata nel blocco, id sconosciuto = null)", async () => {
  const w = world();
  const s = await on(() => MB.findBookingStoreById(w.admin, "bo-1"));
  assert.equal(s?.table, "org_state");
  assert.equal(s?.tableKinds, undefined);
  assert.equal(await on(() => MB.findBookingStoreById(w.admin, "non-c-e")), null);
});

// ───────────────────────── (b) autorita' 'table': store dalle tabelle ─────────────────────────
test("findBookingStore con bookings+structures+guests 'table' e blocco svuotato: store ricomposto dalle tabelle, units/roomTypes dal blocco", async () => {
  const w = world({ u: TABLE_ALL });
  assert.deepEqual(blobOf(w.db).bookings, [], "il blocco non ha piu' le prenotazioni");
  const s = await on(() => MB.findBookingStore(w.admin, SLUG, "g-1"));
  assert.ok(s);
  assert.equal(s!.table, "app_state");
  assert.equal(s!.booking.id, "g-1");
  assert.equal(s!.booking.paid, 0);
  assert.equal(s!.structure?.name, "Casa");
  assert.equal(s!.guest?.fullName, "Anna Rossi");
  assert.equal(s!.roomType?.name, "Doppia", "roomTypes e' ancora del blocco");
  assert.equal(s!.sid, "S1");
  assert.equal(s!.ownerId, OWN);
  assert.deepEqual(ids(s!.data.bookings as J[]), ["b-1", "g-1", "g-2"], "tutte le prenotazioni (gruppo, availability) come nel blocco di prima");
  assert.equal(s!.data.bookings[s!.bookingIndex].id, "g-1");
  assert.deepEqual(ids(s!.data.units as J[]), ["U1", "U2"]);
  assert.deepEqual([...(s!.tableKinds ?? [])].sort(), ["bookings", "guests", "structures"]);
  assert.deepEqual(s!.blockData?.bookings, [], "blockData conserva il blocco originale");
  assert.equal(s!.rev, 1, "rev del blocco (per le chiavi piatte)");
  assert.equal(blobUpdates(w.db), 0);
});

test("tipi misti: solo structures 'table' => prenotazione e ospite dal blocco, struttura dalla tabella", async () => {
  const w = world({ u: ["structures"] });
  const s = await on(() => MB.findBookingStore(w.admin, SLUG, "b-1"));
  assert.ok(s);
  assert.equal(s!.structure?.name, "Casa");
  assert.deepEqual(s!.tableKinds, ["structures"]);
  assert.deepEqual(ids(s!.data.bookings as J[]), ["b-1", "g-1", "g-2"]);
  assert.equal(w.db.log.filter((l) => l.table === "entities" && l.filters.some((f) => f.col === "kind" && f.val === "bookings")).length, 0, "le prenotazioni non si leggono dalle tabelle");
});

test("organizzazione 'table': findBookingStore la trova prima del personale; findBookingStoreForTenant solo se membro", async () => {
  const w = world({ o: TABLE_ALL });
  const s = await on(() => MB.findBookingStore(w.admin, SLUG, "bo-1"));
  assert.equal(s?.table, "org_state");
  assert.equal(s?.keyVal, ORG);
  assert.equal(s?.structure?.name, "Central Perk");
  assert.equal(s?.guest?.fullName, "Carla Neri");
  const t = await on(() => MB.findBookingStoreForTenant(w.admin, OWN, "bo-1"));
  assert.equal(t?.booking.id, "bo-1");
  assert.equal(t?.ownerId, OWN);
  assert.equal(await on(() => MB.findBookingStoreForTenant(w.admin, "estraneo", "bo-1")), null);
  // una prenotazione dell'altro proprietario non si trova nell'org
  const x = await on(() => MB.findBookingStore(w.admin, SLUG, "g-1"));
  assert.equal(x?.table, "app_state");
});

test("una prenotazione che non e' di questo proprietario non costa il caricamento delle collezioni", async () => {
  const w = world({ o: TABLE_ALL });
  await on(() => MB.findBookingStore(w.admin, SLUG, "g-1")); // cerca prima nell'org (table): nessuna riga bo con quell'id
  const big = w.db.log.filter((l) => l.table === "entities" && l.range && l.filters.some((f) => f.col === "kind" && f.val === "guests"));
  assert.equal(big.length, 0, "ospiti dell'org non letti");
});

test("findBookingStoreById: la scansione dei blocchi non la trova ma la ricerca per id nelle tabelle si' (SERVER_READ_ENTITIES spenta), con cache", async () => {
  const w = world({ u: TABLE_ALL });
  const s = await on(() => MB.findBookingStoreById(w.admin, "g-2"));
  assert.ok(s);
  assert.equal(s!.table, "app_state");
  assert.equal(s!.booking.id, "g-2");
  assert.equal(s!.structure?.name, "Casa");
  // seconda volta: dalla cache, una scansione del solo proprietario
  const before = w.db.log.filter((l) => l.table === "app_state" || l.table === "org_state").length;
  const s2 = await on(() => MB.findBookingStoreById(w.admin, "g-2"));
  assert.equal(s2?.booking.id, "g-2");
  assert.equal(w.db.log.filter((l) => l.table === "app_state" || l.table === "org_state").length - before, 1);
  // un id che non esiste: null, e conta come ricerca fallita
  assert.equal(await on(() => MB.findBookingStoreById(w.admin, "non-c-e")), null);
});

test("findBookingStoreById con SERVER_READ_ENTITIES=on e compare: stessa prenotazione (compare restituisce il blocco+tabelle e non registra differenze)", async () => {
  const lines: J[] = [];
  SE._setEntitiesLogger((_l: string, line: string) => { lines.push(JSON.parse(line.slice("[entities-compare] ".length))); });
  try {
    const w = world({ u: TABLE_ALL });
    const a = await withEnv({ w: "on", r: "on" }, () => MB.findBookingStoreById(w.admin, "g-1"));
    assert.equal(a?.booking.id, "g-1");
    assert.deepEqual([...(a?.tableKinds ?? [])].sort(), ["bookings", "guests", "structures"]);
    const w2 = world({ u: TABLE_ALL });
    const c = await withEnv({ w: "on", r: "compare" }, () => MB.findBookingStoreById(w2.admin, "g-1"));
    assert.equal(c?.booking.id, "g-1");
    assert.equal(lines.filter((l) => l.result === "diff").length, 0, JSON.stringify(lines));
  } finally { SE._setEntitiesLogger(null); }
});

// ───────────────────────── (c) errori: mai un ripiego sul blocco vuoto ─────────────────────────
test("autorita' 'table' ma tabelle illeggibili: store non trovato (niente eccezioni, niente scrittura)", () => mute(async () => {
  const w = world({ u: TABLE_ALL, failEntities: "database giu'" });
  assert.equal(await on(() => MB.findBookingStore(w.admin, SLUG, "g-1")), null);
  assert.equal(await on(() => MB.findBookingStoreById(w.admin, "g-1")), null);
  assert.equal(await on(() => MB.findBookingStoreForTenant(w.admin, OWN, "g-1")), null);
  assert.equal(blobUpdates(w.db), 0);
}));

test("errore nel leggere l'autorita' con il blocco ancora pieno: si usa il blocco, come oggi", async () => {
  const w = world({ u: TABLE_ALL, keepBlock: true, authError: { code: "XX000", message: "boom" } });
  const s = await on(() => MB.findBookingStore(w.admin, SLUG, "g-1"));
  assert.equal(s?.booking.id, "g-1");
  assert.equal(s?.tableKinds, undefined);
  assert.equal(ent(w.db), 0);
});

test("la tabella entities e' in ritardo: prenotazione presente nel blocco ma non nelle tabelle con autorita' 'table' => non trovata (la verita' e' la tabella)", async () => {
  const w = world({ u: ["bookings"], keepBlock: true });
  w.db.tables.entities = w.db.tables.entities.filter((r) => r.id !== "b-1");
  assert.equal(await on(() => MB.findBookingStore(w.admin, SLUG, "b-1")), null);
  assert.equal((await on(() => MB.findBookingStore(w.admin, SLUG, "g-1")))?.booking.id, "g-1");
});

// ───────────────────────── (d) scritture: il blocco non riceve mai le collezioni delle tabelle ─────────────────────────
test("scrittori: findBookingStore + writeBookingPatch/mutateStore('scope') con bookings 'table' scrivono la riga, il blocco resta com'e'", async () => {
  const w = world({ u: TABLE_ALL });
  const s = (await on(() => MB.findBookingStore(w.admin, SLUG, "b-1")))!;
  assert.equal(await on(() => MB.writeBookingPatch(w.admin, s, { changeRequest: { at: 1 }, updatedAt: 4000 })), true);
  assert.deepEqual(row(w.db, "b-1").data.changeRequest, { at: 1 });
  assert.equal(row(w.db, "b-1").updated_ms, 4000);
  const s2 = (await on(() => MB.findBookingStore(w.admin, SLUG, "g-1")))!;
  assert.equal(await on(() => MB.mutateStore(w.admin, s2, (d: J) => { (d.bookings as J[]).forEach((b) => { b.paid = 50; }); return true; }, { tables: "scope" })), true);
  assert.equal(row(w.db, "g-1").data.paid, 50);
  assert.equal(row(w.db, "g-2").data.paid, 50);
  assert.equal(row(w.db, "b-1").data.paid, 100);
  assert.equal(blobUpdates(w.db), 0, "il blocco non e' stato toccato");
  assert.deepEqual(blobOf(w.db).bookings, []);
  // e rileggendo lo store si vede il nuovo valore
  assert.equal((await on(() => MB.findBookingStore(w.admin, SLUG, "g-1")))?.booking.paid, 50);
});

test("scrittore non migrato (mutateStore senza opzioni, es. /api/checkin) con bookings 'table': rifiuta e non scrive il blocco", async () => {
  const w = world({ u: TABLE_ALL });
  const s = (await on(() => MB.findBookingStore(w.admin, SLUG, "b-1")))!;
  assert.equal(await on(() => MB.mutateStore(w.admin, s, (d: J) => { d.bookings[s.bookingIndex].paid = 9; return true; })), false);
  assert.equal(blobUpdates(w.db), 0);
  assert.equal(rowUpdates(w.db), 0);
});

test("store misto (solo structures 'table'): la scrittura del blocco sulle prenotazioni funziona e NON mette le strutture nel blocco", async () => {
  const w = world({ u: ["structures"] });
  const s = (await on(() => MB.findBookingStore(w.admin, SLUG, "b-1")))!;
  assert.equal(s.structure?.name, "Casa");
  // scrittore migrato ("scope"): bookings e' 'blob' => percorso del blocco; la funzione vede la struttura (dalla tabella) e calcola con quella
  let seen = "";
  const ok = await on(() => MB.mutateStore(w.admin, s, (d: J) => { seen = String(d.structures.find((x: J) => x.id === d.bookings[s.bookingIndex].structureId)?.name); d.bookings[s.bookingIndex].paid = 77; return true; }, { tables: "scope" }));
  assert.equal(seen, "Casa", "la struttura sta solo nella tabella: la funzione la deve trovare, non undefined");
  assert.equal(ok, true);
  assert.equal(blobUpdates(w.db), 1);
  const b = blobOf(w.db);
  assert.equal(b.bookings.find((x: J) => x.id === "b-1").paid, 77);
  assert.deepEqual(b.structures, [], "le strutture (lette dalle tabelle) non sono finite nel blocco");
  assert.equal(b.units.length, 2, "il resto del blocco e' intatto");
  assert.equal((w.db.tables.app_state[0].data as J)["spigolestay:threads:v1"], "{}", "chiavi piatte intatte");
});

test("store misto: una funzione che modifica una collezione 'table' attraverso il blocco viene rifiutata (nessuna scrittura)", () => mute(async () => {
  const w = world({ u: ["structures"] });
  const s = (await on(() => MB.findBookingStore(w.admin, SLUG, "b-1")))!;
  const ok = await on(() => MB.mutateStore(w.admin, s, (d: J) => { d.structures[0].name = "Cambiata"; d.bookings[s.bookingIndex].paid = 1; return true; }, { tables: "scope" }));
  assert.equal(ok, false);
  assert.equal(blobUpdates(w.db), 0);
  assert.equal(blobOf(w.db).bookings.find((x: J) => x.id === "b-1").paid, 100);
}));

test("store misto con conflitto sul rev: la seconda scansione rimette lo stesso schema (strutture ancora fuori dal blocco)", async () => {
  const w = world({ u: ["structures"] });
  const s = (await on(() => MB.findBookingStore(w.admin, SLUG, "b-1")))!;
  w.db.tables.app_state[0].rev = 5; // qualcuno ha scritto dopo la lettura => il primo tentativo va in conflitto
  const ok = await on(() => MB.mutateStore(w.admin, s, (d: J) => { d.bookings[s.bookingIndex].paid = 11; return true; }, { tables: "scope" }));
  assert.equal(ok, true);
  assert.deepEqual(blobOf(w.db).structures, []);
  assert.equal(blobOf(w.db).bookings.find((x: J) => x.id === "b-1").paid, 11);
});

// ───────────────────────── lettori: caricatori dei dati ─────────────────────────
test("loadOrgData / loadOrgDatas: org 'table' dalle tabelle (a prescindere da SERVER_READ_ENTITIES), senza 'table' o interruttore spento = blocco com'e'", async () => {
  const w = world({ o: TABLE_ALL });
  const d = (await on(() => OD.loadOrgData(w.admin, ORG)))!;
  assert.deepEqual(ids(d.bookings), ["bo-1"]);
  assert.equal(d.structures[0].name, "Central Perk");
  assert.deepEqual(ids(d.units), ["UO"], "units dal blocco");
  assert.deepEqual(ids((await on(() => OD.loadOrgDatas(w.admin, OWN)))[0].bookings), ["bo-1"]);
  // interruttore spento: il blocco svuotato e basta, e nessuna lettura delle tabelle
  const w2 = world({ o: TABLE_ALL });
  const off = (await withEnv({}, () => OD.loadOrgData(w2.admin, ORG)))!;
  assert.deepEqual(off.bookings, []);
  assert.equal(ent(w2.db) + authCalls(w2.log), 0);
  // nessuna riga: identico al blocco
  const w3 = world();
  assert.deepEqual(await on(() => OD.loadOrgData(w3.admin, ORG)), blobOf(w3.db, "org_state"));
  assert.equal(ent(w3.db), 0);
});

test("loadOrgData: org con tabelle illeggibili e autorita' 'table' => null (org saltata), niente eccezioni", () => mute(async () => {
  const w = world({ o: TABLE_ALL, failEntities: "giu'" });
  assert.equal(await on(() => OD.loadOrgData(w.admin, ORG)), null);
  assert.deepEqual(await on(() => OD.loadOrgDatas(w.admin, OWN)), []);
}));

test("loadTenantData: personale 'table' + org 'table' ricomposti e fusi; in compare il risultato e' il blocco+tabelle e non ci sono differenze registrate", async () => {
  const lines: J[] = [];
  SE._setEntitiesLogger((_l: string, line: string) => { lines.push(JSON.parse(line.slice("[entities-compare] ".length))); });
  try {
    const w = world({ u: TABLE_ALL, o: TABLE_ALL });
    const d = await withEnv({ w: "on", r: "compare" }, () => OD.loadTenantData(w.admin, OWN));
    assert.deepEqual(ids(d.bookings), ["b-1", "bo-1", "g-1", "g-2"]);
    assert.deepEqual(ids(d.structures), ["S1", "SO"]);
    assert.deepEqual(ids(d.guests), ["G1", "GO1"]);
    assert.equal(lines.filter((l) => l.result === "diff" || l.result === "error").length, 0, JSON.stringify(lines));
    const e = await withEnv({ w: "on", r: "off" }, () => OD.loadTenantData(w.admin, OWN));
    assert.deepEqual(e, d);
    const f = await withEnv({ w: "on", r: "on" }, () => OD.loadTenantData(w.admin, OWN));
    assert.deepEqual(ids(f.bookings), ["b-1", "bo-1", "g-1", "g-2"]);
    // spento: blocco svuotato (comportamento di oggi)
    const g = await withEnv({}, () => OD.loadTenantData(w.admin, OWN));
    assert.deepEqual(g.bookings, []);
  } finally { SE._setEntitiesLogger(null); }
});

test("loadTenantData: errore di lettura delle tabelle sul personale => resta il blocco (nessuna eccezione)", () => mute(async () => {
  const w = world({ u: TABLE_ALL, failEntities: "giu'" });
  const d = await on(() => OD.loadTenantData(w.admin, OWN));
  assert.deepEqual(ids(d.bookings), ["bo-1"], "del personale non arriva nulla (blocco vuoto), l'org non è 'table' e resta del blocco");
  assert.deepEqual(ids(d.units), ["U1", "U2", "UO"]);
}));

test("server-booking-guard: loadOwnerStructureData, loadOrgDataParts e findOwnerStructure leggono dalle tabelle i tipi 'table'", async () => {
  const w = world({ u: ["structures", "bookings"], o: ["structures", "bookings"] });
  const personalData = await on(() => BG.loadOwnerStructureData(w.admin, OWN, "S1"));
  assert.ok(personalData, "struttura personale trovata anche con le strutture fuori dal blocco");
  assert.deepEqual(ids(personalData!.bookings), ["b-1", "g-1", "g-2"]);
  assert.deepEqual(ids(personalData!.units as J[]), ["U1", "U2"]);
  const orgSide = await on(() => BG.loadOwnerStructureData(w.admin, OWN, "SO"));
  assert.deepEqual(ids(orgSide!.bookings), ["bo-1"]);
  assert.equal(await on(() => BG.loadOwnerStructureData(w.admin, OWN, "S-altrui")), null);
  const parts = await on(() => BG.loadOrgDataParts(w.admin, OWN));
  assert.deepEqual(ids(parts[0].bookings as J[]), ["bo-1"]);
  assert.equal((await on(() => BG.findOwnerStructure(w.admin, OWN, "S1")))?.name, "Casa");
  assert.equal((await on(() => BG.findOwnerStructure(w.admin, OWN, "SO")))?.stripeAccount, "acct_org");
  assert.equal(await on(() => BG.findOwnerStructure(w.admin, OWN, "S-altrui")), null);
  // interruttore spento: il blocco svuotato non trova la struttura (comportamento di oggi)
  assert.equal(await withEnv({}, () => BG.findOwnerStructure(w.admin, OWN, "S1")), null);
});

test("server-booking-guard con tabelle illeggibili e autorita' 'table': null / niente (mai dati finti vuoti spacciati per veri)", () => mute(async () => {
  const w = world({ u: ["structures", "bookings"], o: ["structures", "bookings"], failEntities: "giu'" });
  assert.equal(await on(() => BG.loadOwnerStructureData(w.admin, OWN, "S1")), null);
  assert.equal(await on(() => BG.findOwnerStructure(w.admin, OWN, "S1")), null);
}));

test("server-booking-guard senza 'table' e a interruttore acceso: stesso risultato del blocco", async () => {
  const w = world();
  const a = await on(() => BG.loadOwnerStructureData(w.admin, OWN, "S1"));
  const b = await withEnv({}, () => BG.loadOwnerStructureData(w.admin, OWN, "S1"));
  assert.deepEqual(a, b);
  assert.equal(ent(w.db), 0);
});

// ───────────────────────── utilita' ─────────────────────────
test("overlayTableKinds / withTableKinds: stesso oggetto se non c'e' nulla da sostituire; kind non gestiti ignorati", async () => {
  const w = world({ u: ["bookings", "units"] });
  const d: J = { bookings: [], note: 1 };
  const same = await withEnv({}, () => ST.overlayTableKinds(w.admin, { type: "u", id: OWN }, d));
  assert.equal(same.data, d);
  assert.deepEqual(same.tableKinds, []);
  const o = await on(() => ST.overlayTableKinds(w.admin, { type: "u", id: OWN }, d, ["bookings"]));
  assert.notEqual(o.data, d);
  assert.deepEqual(o.tableKinds, ["bookings"], "units non richiesto");
  assert.equal(o.data.note, 1);
  assert.deepEqual(ids(o.data.bookings as J[]), ["b-1", "g-1", "g-2"]);
  assert.deepEqual(d.bookings, [], "l'oggetto ricevuto non viene modificato");
});

// ───────────────────────── scrittori non migrati e autorita' di TUTTI i tipi che possono usare ─────────────────────────
const legacyStore = (w: ReturnType<typeof world>, id = "b-1"): J => {
  const d = JSON.parse((w.db.tables.app_state[0].data as J)[DATA_KEY]);
  const idx = d.bookings.findIndex((b: J) => b.id === id);
  return { table: "app_state", keyCol: "user_id", keyVal: OWN, blob: w.db.tables.app_state[0].data, data: d, rev: 1, booking: d.bookings[idx] ?? { id }, bookingIndex: idx, structure: null, roomType: null, guest: null, ownerId: OWN, sid: "S1" };
};

test("scrittore NON migrato (mutateStore senza opzioni) con bookings 'blob' ma structures/guests/roomTypes/units 'table': rifiuta e non scrive il blocco", async () => {
  for (const kind of ["structures", "guests", "roomTypes", "units"]) {
    const w = world({ u: [kind], keepBlock: true });
    const s = legacyStore(w);
    const r = await on(() => W.mutateBookingScope(w.admin, { ownerType: "u", ownerId: OWN, bookingId: "b-1", supported: false, mutate: () => true }));
    assert.deepEqual({ handled: (r as J).handled, ok: (r as J).ok, error: (r as J).error }, { handled: true, ok: false, error: "writer_not_migrated" }, kind);
    assert.match(String((r as J).message), new RegExp(kind));
    assert.equal(await on(() => MB.mutateStore(w.admin, s, (d: J) => { d.bookings[s.bookingIndex].paid = 9; return true; })), false, kind);
    assert.equal(blobUpdates(w.db), 0, kind);
  }
});

test("scrittore non migrato senza nessun tipo 'table' (o a interruttore spento / tabella assente / blob): scrive il blocco come sempre", async () => {
  for (const [label, env, o] of [["nessuna riga", { w: "on" }, {}], ["spento", {}, { u: TABLE_ALL, keepBlock: true }], ["tabella assente", { w: "on" }, { authTable: false }], ["blob", { w: "on" }, { authRows: [{ owner_type: "u", owner_id: OWN, kind: "structures", authority: "blob" }] }]] as const) {
    const w = world(o as never);
    const s = legacyStore(w);
    assert.equal(await withEnv(env, () => MB.mutateStore(w.admin, s, (d: J) => { d.bookings[s.bookingIndex].paid = 9; return true; })), true, label);
    assert.equal(blobOf(w.db).bookings[0].paid, 9, label);
    assert.equal(blobUpdates(w.db), 1, label);
  }
});

test("un callback 'scope' con structures 'table' e bookings 'blob' vede la struttura (non undefined) e calcola con quella", async () => {
  const w = world({ u: ["structures"] });
  const s = (await on(() => MB.findBookingStoreForTenant(w.admin, OWN, "b-1")))!;
  assert.equal(s.structure?.name, "Casa");
  let seen: unknown;
  assert.equal(await on(() => MB.mutateStore(w.admin, s, (d: J) => { const st = d.structures.find((x: J) => x.id === d.bookings[s.bookingIndex].structureId); seen = st?.stripeAccount; d.bookings[s.bookingIndex].paid = 5; return true; }, { tables: "scope" })), true);
  assert.equal(seen, "acct_pers");
  assert.equal(blobOf(w.db).bookings.find((x: J) => x.id === "b-1").paid, 5);
  assert.deepEqual(blobOf(w.db).structures, []);
});

// ───────────────────────── autorita' illeggibile con interruttore acceso: fail-closed ─────────────────────────
test("errore nel leggere l'autorita' (interruttore acceso): tutti gli scrittori rifiutano con read_error e NON scrivono ne' tabelle ne' blocco", async () => {
  for (const authError of [{ code: "XX000", message: "boom" }, "throws" as const]) {
    const w = world({ authError });
    const ba = { ownerType: "u" as const, ownerId: OWN };
    const p = await on(() => W.patchEntity(w.admin, { ...ba, kind: "bookings", id: "b-1", patch: { note: "x" } })) as J;
    assert.deepEqual([p.handled, p.ok, p.error], [true, false, "read_error"]);
    const sc = await on(() => W.mutateBookingScope(w.admin, { ...ba, bookingId: "b-1", supported: true, mutate: () => true })) as J;
    assert.deepEqual([sc.handled, sc.ok, sc.error], [true, false, "read_error"]);
    const su = await on(() => W.mutateBookingScope(w.admin, { ...ba, bookingId: "b-1", supported: false, mutate: () => true })) as J;
    assert.equal(su.error, "read_error");
    const set = await on(() => W.mutateEntitySet(w.admin, { ...ba, kind: "bookings", load: async () => [], compute: () => ({ action: "none" }) })) as J;
    assert.deepEqual([set.handled, set.outcome], [true, "error"]);
    // punti reali
    const s = legacyStore(w);
    assert.equal(await on(() => MB.writeBookingPatch(w.admin, s, { note: "x" })), false);
    assert.equal(await on(() => MB.mutateStore(w.admin, s, (d: J) => { d.bookings[0].paid = 1; return true; }, { tables: "scope" })), false);
    assert.equal(await on(() => MB.mutateStore(w.admin, s, (d: J) => { d.bookings[0].paid = 1; return true; })), false);
    assert.equal(await on(() => AT.markReviewRequested(w.admin, { table: "app_state", keyCol: "user_id", keyVal: OWN }, "b-1", "email")), false);
    assert.notEqual(await on(() => SR.reconcileCharge(w.admin, { amount: 100, amount_refunded: 100, metadata: { uid: OWN } }, "pi_1", false)), "ok", "il webhook Stripe NON risponde ok: Stripe ritentera'");
    assert.equal(blobUpdates(w.db), 0);
    assert.equal(rowUpdates(w.db), 0);
  }
});

test("autorita' illeggibile ma interruttore SPENTO o tabella assente: come oggi (blocco), perche' senza interruttore l'autorita' non si legge nemmeno", async () => {
  const w = world({ authError: { code: "XX000", message: "boom" } });
  const s = legacyStore(w);
  assert.equal(await withEnv({}, () => MB.writeBookingPatch(w.admin, s, { note: "x" })), true);
  assert.equal(authCalls(w.log), 0);
  assert.equal(blobOf(w.db).bookings[0].note, "x");
  const w2 = world({ authTable: false });
  assert.equal(await on(() => MB.writeBookingPatch(w2.admin, legacyStore(w2), { note: "y" })), true, "tabella assente = nessun proprietario 'table'");
});
