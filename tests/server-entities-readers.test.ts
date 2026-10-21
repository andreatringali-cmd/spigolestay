import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeEntitiesDb, entityRowsFromBlock } from "./helpers/fake-entities-db.ts";

// Fase 3, passo 1 (seconda parte): altri lettori portati in modalita' CONFRONTO dietro SERVER_READ_ENTITIES (src/lib/entities-shadow.ts).
// Regole provate per ogni lettore: off = nessuna chiamata a public.entities; on = nessuna chiamata (il punto non e' ancora promosso);
// compare = il risultato restituito e' IDENTICO a quello di off, le differenze con le tabelle finiscono nel registro [entities-compare],
// un errore delle tabelle non rompe mai la richiesta.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const SE = await import("../src/lib/server-entities.ts");
const SH = await import("../src/lib/entities-shadow.ts");
const CF = await import("../src/lib/calendar-feed.ts");
const DR = await import("../src/lib/dates-rome.ts");
const GUARD = await import("../src/lib/stripe-guard.ts");
const ACCESS = await import("../src/app/api/org/access/route.ts");
const MEMBERS = await import("../src/app/api/org/members/route.ts");
const LEAVE = await import("../src/app/api/org/leave/route.ts");
const FEED = await import("../src/app/api/calendar/feed/route.ts");
const ADMIN = await import("../src/app/api/admin/account/route.ts");

const DATA_KEY = "spigolestay:data:v1";
const OWN = "own-1";
const ORG = "org-1";
const G = globalThis as unknown as { __stubs: { admin?: unknown } };

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = Record<string, any>;
const today = DR.todayRome();
const inDays = (n: number) => DR.addDaysYmd(today, n);
const personal = (): J => ({
  structures: [{ id: "S0", name: "Zero", order: 0, city: "Siracusa" }, { id: "S1", name: "Casa", order: 1, stripeAccount: "acct_pers" }],
  roomTypes: [{ id: "RT1", structureId: "S1", name: "Doppia", beds: 2 }],
  units: [{ id: "U1", structureId: "S1", roomTypeId: "RT1", name: "1" }, { id: "U2", structureId: "S1", roomTypeId: "RT1", name: "2" }],
  bookings: [
    { id: "b-1", structureId: "S1", roomTypeId: "RT1", unitId: "U1", guestId: "G1", channel: "direct", status: "confirmed", checkIn: inDays(10), checkOut: inDays(13), code: "XEN-1", total: 300, updatedAt: 5 },
    { id: "b-2", structureId: "S1", roomTypeId: "RT1", unitId: "U2", guestId: "G2", channel: "booking", status: "confirmed", checkIn: inDays(2), checkOut: inDays(4), code: "4455", total: 200, updatedAt: 6 },
    { id: "b-old", structureId: "S1", roomTypeId: "RT1", unitId: "U2", guestId: "G2", channel: "booking", status: "confirmed", checkIn: inDays(-200), checkOut: inDays(-198), total: 50, updatedAt: 1 },
  ],
  guests: [{ id: "G1", fullName: "Anna Rossi" }, { id: "G2", fullName: "Bob Verdi" }, { id: "G3", fullName: "Mai in prenotazione" }],
  directReviews: [], events: [],
});
const orgData = (): J => ({
  structures: [{ id: "SO", name: "Central Perk", orgId: ORG, stripeAccount: "acct_org" }],
  roomTypes: [{ id: "RTO", structureId: "SO", name: "Suite", beds: 3 }],
  units: [{ id: "UO", structureId: "SO", roomTypeId: "RTO", name: "A" }],
  bookings: [{ id: "bo-1", structureId: "SO", roomTypeId: "RTO", unitId: "UO", guestId: "GO1", channel: "direct", status: "confirmed", checkIn: inDays(20), checkOut: inDays(22), total: 400, updatedAt: 7 }],
  guests: [{ id: "GO1", fullName: "Carla Neri" }],
});

function world(opts: { mutateRows?: (rows: J[]) => J[]; callerId?: string } = {}) {
  SE._resetEntityFeatures();
  SH._resetShadowThrottle();
  let rows: J[] = [...entityRowsFromBlock({ type: "u", id: OWN }, personal(), { withNewColumns: true }), ...entityRowsFromBlock({ type: "o", id: ORG }, orgData(), { withNewColumns: true })];
  if (opts.mutateRows) rows = opts.mutateRows(rows);
  const { db, client } = makeFakeEntitiesDb({
    app_state: [{ user_id: OWN, rev: 1, data: { [DATA_KEY]: JSON.stringify(personal()) } }],
    org_state: [{ org_id: ORG, rev: 1, data: { [DATA_KEY]: JSON.stringify(orgData()) } }],
    memberships: [{ user_id: OWN, org_id: ORG, role: "owner", active: true, permissions: null }, { user_id: "coll-1", org_id: ORG, role: "member", active: true, permissions: null }],
    profiles: [{ user_id: OWN, email: "titolare@example.com", full_name: "Titolare" }, { user_id: "coll-1", email: "coll@example.com", full_name: "Collega" }],
    org_invites: [], admin_customer_notes: [],
    entities: rows,
  });
  const base = client as { from: (t: string) => unknown };
  const callerId = opts.callerId ?? OWN;
  const admin = {
    from: base.from,
    auth: {
      getUser: async () => ({ data: { user: { id: callerId, email: "spigolehouse@gmail.com" } } }),
      admin: { getUserById: async (id: string) => ({ data: { user: { id, email: "titolare@example.com" } } }) },
    },
  };
  G.__stubs.admin = admin;
  return { db, admin: admin as never };
}
const ent = (db: { log: { table: string }[] }) => db.log.filter((l) => l.table === "entities").length;

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
const req = (url: string, init: { method?: string; body?: unknown } = {}) => new Request(url, { method: init.method ?? "GET", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined });
const without = (id: string) => (rows: J[]) => rows.filter((r) => r.id !== id);

/** Un lettore in confronto: come si chiama, che cosa restituisce (deve essere IDENTICO in off / on / compare), quale modifica alle tabelle deve generare una differenza e come si riconosce nel registro. */
interface Reader {
  name: string; label: string;
  run: (w: { admin: never; db: any }) => Promise<unknown>;
  breakTables: (rows: J[]) => J[];
  expect: (payload: J) => void;
}

const readers: Reader[] = [
  {
    name: "health (nomi delle strutture)", label: "health.structureNames",
    run: async ({ admin }) => {
      const names = new Map<string, string>(personal().structures.map((s: J) => [s.id, String(s.name).slice(0, 60)] as [string, string]));
      await SH.shadowStructureNames(admin, "health.structureNames", { type: "u", id: OWN }, Object.fromEntries(names), 60_000);
      return [...names.entries()];
    },
    breakTables: (rows) => rows.map((r) => (r.id === "S1" && r.kind === "structures" ? { ...r, data: { ...r.data, name: "Casa Rinominata" } } : r)),
    expect: (p) => { assert.match(String(p.block), /"S1":"Casa"/); assert.match(String(p.tables), /Casa Rinominata/); },
  },
  {
    name: "calendar feed (prenotazioni)", label: "calendar/feed.bookings",
    run: async () => {
      const token = CF.signFeedToken(OWN, "bookings");
      const res = await FEED.GET(req(`https://x.test/api/calendar/feed?u=${OWN}&k=bookings&t=${token}`)) as any;
      assert.equal(res.status, 200);
      return res.body;
    },
    breakTables: without("b-1"),
    expect: (p) => { assert.deepEqual(p.colls.events.onlyBlock, ["booking-b-1@xenora.it"]); },
  },
  {
    name: "calendar feed (pulizie)", label: "calendar/feed.pulizie",
    run: async () => {
      const token = CF.signFeedToken(OWN, "pulizie");
      const res = await FEED.GET(req(`https://x.test/api/calendar/feed?u=${OWN}&k=pulizie&t=${token}`)) as any;
      assert.equal(res.status, 200);
      return res.body;
    },
    breakTables: (rows) => rows.map((r) => (r.id === "U1" ? { ...r, data: { ...r.data, name: "Uno" } } : r)),
    expect: (p) => { assert.ok(p.colls.events.changed.length >= 1); assert.ok(p.colls.events.fields.includes("summary")); },
  },
  {
    name: "admin/account (strutture e camere)", label: "admin/account.structures",
    run: async () => {
      const res = await ADMIN.POST(req("https://x.test/api/admin/account", { method: "POST", body: { userId: OWN } })) as any;
      assert.equal(res.status, 200);
      const b = JSON.parse(JSON.stringify(res.body)); // il generatedAt non c'e': il corpo e' deterministico
      return b;
    },
    breakTables: without("U2"),
    expect: (p) => { assert.deepEqual(p.colls.units.onlyBlock, ["U2"]); },
  },
  {
    name: "org/access (prima struttura dell'organizzazione)", label: "org/access.firstStructure",
    run: async () => {
      const res = await ACCESS.GET(req("https://x.test/api/org/access")) as any;
      assert.equal(res.body.orgs[0].structureName, "Central Perk");
      return res.body;
    },
    breakTables: (rows) => rows.map((r) => (r.id === "SO" && r.kind === "structures" ? { ...r, data: { ...r.data, name: "Altro Nome" } } : r)),
    expect: (p) => { assert.match(String(p.block), /Central Perk/); assert.match(String(p.tables), /Altro Nome/); },
  },
  {
    name: "org/members (organizzazione della struttura)", label: "org/members.resolveOwnerOrg",
    run: async () => {
      const res = await MEMBERS.GET(req("https://x.test/api/org/members?structureId=SO")) as any;
      assert.equal(res.body.isOwner, true);
      return res.body;
    },
    breakTables: without("SO"),
    expect: (p) => { assert.equal(p.block, JSON.stringify(ORG)); assert.equal(p.tables, "null"); },
  },
  {
    name: "org/leave (organizzazione della struttura)", label: "org/leave.orgOfStructure",
    run: async () => {
      const res = await LEAVE.POST(req("https://x.test/api/org/leave", { method: "POST", body: { structureId: "SO" } })) as any;
      assert.equal(res.status, 400); // il titolare non puo' abbandonare: il percorso passa dalla ricerca dell'organizzazione e si ferma prima di scrivere
      assert.equal(res.body.error, "owner_cannot_leave");
      return res.body;
    },
    breakTables: without("SO"),
    expect: (p) => { assert.equal(p.block, JSON.stringify(ORG)); assert.equal(p.tables, "null"); },
  },
  {
    name: "stripe-guard (proprietario del conto collegato)", label: "stripe-guard.userOwnsStripeAccount",
    run: async ({ admin }) => {
      const stripe = { accounts: { retrieve: async () => ({ metadata: {} }) } } as never;
      const out = [await GUARD.userOwnsStripeAccount(stripe, admin, OWN, "acct_org"), await GUARD.userOwnsStripeAccount(stripe, admin, OWN, "acct_pers"), await GUARD.userOwnsStripeAccount(stripe, admin, OWN, "acct_altrui")];
      assert.deepEqual(out, [true, true, false]);
      return out;
    },
    breakTables: (rows) => rows.map((r) => (r.id === "SO" && r.kind === "structures" ? { ...r, data: { ...r.data, stripeAccount: undefined } } : r)),
    expect: (p) => { assert.equal(p.block, "true"); assert.equal(p.tables, "false"); },
  },
  {
    name: "concierge/ask (parte personale)", label: "concierge/ask.personal",
    run: async ({ admin }) => { await SH.shadowOwnerData(admin, "concierge/ask.personal", { type: "u", id: OWN }, personal(), { everyMs: 10 * 60_000 }); return personal().bookings.length; },
    breakTables: without("b-2"),
    expect: (p) => { assert.deepEqual(p.colls.bookings.onlyBlock, ["b-2"]); },
  },
  {
    name: "cron pulizie-plan (parte personale)", label: "pulizie-plan.personal",
    run: async ({ admin }) => { await SH.shadowOwnerData(admin, "pulizie-plan.personal", { type: "u", id: OWN }, personal(), { everyMs: 10 * 60_000 }); return personal().units.length; },
    breakTables: (rows) => rows.map((r) => (r.id === "G1" ? { ...r, data: { ...r.data, fullName: "Anna Bianchi" } } : r)),
    expect: (p) => { assert.deepEqual(p.colls.guests.changed, ["G1"]); assert.ok(p.colls.guests.fields.includes("fullName")); },
  },
  {
    name: "pulizie/send-now (una struttura)", label: "pulizie/send-now.structure",
    run: async ({ admin }) => { await SH.shadowStructureScope(admin, "pulizie/send-now.structure", { type: "u", id: OWN }, "S1", personal()); return "S1"; },
    breakTables: without("b-1"),
    expect: (p) => { assert.deepEqual(p.colls.bookings.onlyBlock, ["b-1"]); },
  },
];

for (const r of readers) {
  test(`${r.name}: off e on non toccano public.entities e non scrivono nel registro`, async () => {
    for (const mode of [undefined, "off", "on"]) {
      const w = world();
      const lines = captureLog();
      await withMode(mode, () => r.run(w));
      assert.equal(ent(w.db), 0, `modo ${mode}: nessuna chiamata a entities`);
      assert.equal(lines.length, 0, `modo ${mode}: registro vuoto`);
    }
  });

  test(`${r.name}: compare restituisce lo STESSO risultato di off e, a dati uguali, scrive solo una riga 'ok'`, async () => {
    const off = world();
    const expected = await withMode("off", () => r.run(off));
    const w = world();
    const lines = captureLog();
    const got = await withMode("compare", () => r.run(w));
    assert.deepEqual(got, expected, "risultato invariato");
    assert.ok(ent(w.db) > 0, "ha letto anche le tabelle");
    const mine = lines.filter((l) => l.payload.label === r.label);
    assert.equal(mine.length, 1, "una sola riga per questo punto");
    assert.deepEqual([mine[0].level, mine[0].payload.result], ["info", "ok"], JSON.stringify(mine[0].payload));
  });

  test(`${r.name}: compare con le tabelle diverse segnala la differenza e il risultato resta quello del blocco`, async () => {
    const off = world();
    const expected = await withMode("off", () => r.run(off));
    const w = world({ mutateRows: r.breakTables });
    const lines = captureLog();
    const got = await withMode("compare", () => r.run(w));
    assert.deepEqual(got, expected, "risultato invariato anche con le tabelle diverse");
    const d = lines.find((l) => l.payload.label === r.label);
    assert.ok(d, "differenza registrata per " + r.label + ": " + JSON.stringify(lines.map((l) => l.payload)));
    assert.equal(d.level, "warn");
    assert.equal(d.payload.result, "diff");
    r.expect(d.payload);
  });

  test(`${r.name}: se le tabelle vanno in errore la richiesta funziona comunque (riga 'error')`, async () => {
    const off = world();
    const expected = await withMode("off", () => r.run(off));
    const w = world();
    // gli errori si accendono DOPO la sonda delle colonne: qui tutte le letture di entities falliscono
    w.db.failEntities = "connessione persa";
    const lines = captureLog();
    const got = await withMode("compare", () => r.run(w));
    assert.deepEqual(got, expected, "risultato invariato");
    const e = lines.find((l) => l.payload.label === r.label);
    assert.ok(e, "errore registrato");
    assert.equal(e.payload.result, "error");
    assert.match(String(e.payload.message), /connessione persa/);
  });
}

// ───────────────────────── regole comuni ─────────────────────────
test("entitiesShadow con `diff`: confronto per id invece che sul JSON intero", async () => {
  const lines = captureLog();
  await withMode("compare", async () => {
    await SE.entitiesShadow("x.cmp", { a: 1 }, async () => ({ a: 2 }), undefined, () => ({ custom: "per-id" }));
    await SE.entitiesShadow("x.same", { a: 1 }, async () => ({ a: 2 }), undefined, () => null);
  });
  assert.deepEqual([lines[0].payload.label, lines[0].payload.result], ["x.cmp", "diff"]);
  assert.equal(lines[0].payload.custom, "per-id");
  assert.equal(lines[0].payload.block, undefined, "non il confronto sul JSON intero");
  assert.deepEqual([lines[1].payload.label, lines[1].payload.result], ["x.same", "ok"]);
});

test("limite di frequenza: il confronto pesante gira una volta sola nella finestra, poi di nuovo dopo", async () => {
  const w = world();
  captureLog();
  await withMode("compare", async () => {
    await SH.shadowOwnerData(w.admin, "limite.prova", { type: "u", id: OWN }, personal(), { everyMs: 60_000 });
    const n = ent(w.db);
    assert.ok(n > 0);
    await SH.shadowOwnerData(w.admin, "limite.prova", { type: "u", id: OWN }, personal(), { everyMs: 60_000 });
    assert.equal(ent(w.db), n, "seconda chiamata entro la finestra: nessuna lettura");
    await SH.shadowOwnerData(w.admin, "limite.prova", { type: "u", id: "altro-account" }, personal(), { everyMs: 60_000 });
    assert.ok(ent(w.db) > n, "un altro proprietario ha il suo limite");
    SH._resetShadowThrottle();
    const m = ent(w.db);
    await SH.shadowOwnerData(w.admin, "limite.prova", { type: "u", id: OWN }, personal(), { everyMs: 60_000 });
    assert.ok(ent(w.db) > m);
  });
});

test("un errore QUALUNQUE dentro il confronto non arriva mai al chiamante (anche con un dato del blocco malformato)", async () => {
  const w = world();
  captureLog();
  await withMode("compare", async () => {
    await SH.shadowOwnerData(w.admin, "rotto.1", { type: "u", id: OWN }, { bookings: "non-un-array", guests: null } as never);
    await SH.shadowOwnersData(w.admin, "rotto.2", [{ type: "u", id: OWN }], []); // meno blocchi che proprietari
    await SH.shadowOrgOfStructure(w.admin, "rotto.3", ["", ORG], "SO", null);
    await SH.shadowStructureScope(w.admin, "rotto.4", { type: "u", id: OWN }, "S1", { bookings: [null, 5, "x"], structures: [null] } as never);
    await SH.shadowStripeOwnership({ from: () => { throw new Error("db rotto"); } } as never, OWN, "acct_x", { skipPersonal: false, orgIds: [ORG], fromBlock: false });
    await CF.shadowCalendarFeed({ from: () => { throw new Error("db rotto"); } } as never, OWN, "bookings", []);
  });
});

test("calendar feed: i blocchi camera e le prenotazioni annullate non entrano (stessa regola dal blocco e dalle tabelle)", async () => {
  const extra = [
    { owner_type: "u", owner_id: OWN, kind: "bookings", id: "b-blk", structure_id: "S1", data: { id: "b-blk", structureId: "S1", unitId: "U1", channel: "blocked", status: "confirmed", checkIn: inDays(30), checkOut: inDays(31) }, check_in: inDays(30), check_out: inDays(31), status: "confirmed", channel: "blocked" },
    { owner_type: "u", owner_id: OWN, kind: "bookings", id: "b-can", structure_id: "S1", data: { id: "b-can", structureId: "S1", unitId: "U1", guestId: "G1", channel: "direct", status: "cancelled", checkIn: inDays(40), checkOut: inDays(41) }, check_in: inDays(40), check_out: inDays(41), status: "cancelled", channel: "direct" },
  ];
  const w = world({ mutateRows: (rows) => rows.concat(extra) });
  const lines = captureLog();
  // nel blocco ci sono le stesse due righe
  const p = personal(); p.bookings.push(extra[0].data, extra[1].data);
  (w.db.tables.app_state[0].data as J)[DATA_KEY] = JSON.stringify(p);
  const token = CF.signFeedToken(OWN, "bookings");
  const res = await withMode("compare", () => FEED.GET(req(`https://x.test/api/calendar/feed?u=${OWN}&k=bookings&t=${token}`))) as any;
  assert.equal(res.status, 200);
  assert.ok(!String(res.body).includes("b-blk") && !String(res.body).includes("b-can"));
  assert.equal(lines.find((l) => l.payload.label === "calendar/feed.bookings")?.payload.result, "ok");
});

test("calendar feed: token sbagliato = 403 e nessuna lettura delle tabelle", async () => {
  const w = world();
  const lines = captureLog();
  const res = await withMode("compare", () => FEED.GET(req(`https://x.test/api/calendar/feed?u=${OWN}&k=bookings&t=sbagliato`))) as Response;
  assert.equal(res.status, 403);
  assert.equal(ent(w.db), 0);
  assert.equal(lines.length, 0);
});

test("org/access con piu' strutture nell'organizzazione: l'ordine diverso tra blocco e tabelle si vede nel registro", async () => {
  // il blocco tiene l'ordine dell'array, le tabelle l'ordine scelto dall'utente (campo order): se la prima struttura cambia, org/access mostrerebbe un'altra
  const od = orgData(); od.structures.push({ id: "SO2", name: "Secondo", orgId: ORG, order: 0 });
  const w = world({ mutateRows: (rows) => rows.concat(entityRowsFromBlock({ type: "o", id: ORG }, { structures: [od.structures[1]] }, {})) });
  (w.db.tables.org_state[0].data as J)[DATA_KEY] = JSON.stringify(od);
  const lines = captureLog();
  const res = await withMode("compare", () => ACCESS.GET(req("https://x.test/api/org/access"))) as any;
  assert.equal(res.body.orgs[0].structureId, "SO", "vale la prima del blocco");
  const d = lines.find((l) => l.payload.label === "org/access.firstStructure");
  assert.equal(d?.payload.result, "diff");
  assert.match(String(d?.payload.tables), /SO2/);
});
