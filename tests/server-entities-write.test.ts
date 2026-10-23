import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeEntitiesDb, entityRowsFromBlock, type FakeEntitiesDb } from "./helpers/fake-entities-db.ts";

// Fase 3, passo 3a: scrittori del server a riga singola (src/lib/server-entities-write.ts), SPENTI DI DEFAULT.
// Con un finto client Supabase si prova che:
//  (a) interruttore spento, tabella entity_authority assente, riga assente o autorita' 'blob' => nessuna scrittura su public.entities e { handled:false }
//      (e i punti di scrittura reali - writeBookingPatch, mutateStore, riconciliazione Stripe, markReviewRequested - proseguono sul blocco come sempre);
//  (b) autorita' 'table' => la riga viene aggiornata con compare-and-set su updated_ms; conflitto => errore chiaro (dopo i nuovi tentativi);
//  (c) un errore nel leggere l'autorita' o nell'helper non rompe mai la richiesta (ricade sul percorso attuale / riporta un errore, senza lanciare).
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const W = await import("../src/lib/server-entities-write.ts");
const MB = await import("../src/lib/manage-booking.ts");
const SR = await import("../src/lib/stripe-reconcile.ts");
const AT = await import("../src/lib/auto-trace.ts");

const DATA_KEY = "spigolestay:data:v1";
const OWN = "own-1";
const ORG = "org-1";
/* eslint-disable @typescript-eslint/no-explicit-any */
type J = Record<string, any>;

const personal = (): J => ({
  structures: [{ id: "S1", name: "Casa" }],
  roomTypes: [{ id: "RT1", structureId: "S1", name: "Doppia" }],
  units: [{ id: "U1", structureId: "S1", roomTypeId: "RT1", name: "1" }],
  bookings: [
    { id: "b-1", structureId: "S1", roomTypeId: "RT1", unitId: "U1", guestId: "G1", channel: "direct", status: "confirmed", checkIn: "2026-11-10", checkOut: "2026-11-13", stripePaymentIntent: "pi_1", paid: 100, total: 300, updatedAt: 1000 },
    { id: "g-1", structureId: "S1", roomTypeId: "RT1", groupId: "grp1", guestId: "G1", channel: "direct", status: "confirmed", checkIn: "2026-12-01", checkOut: "2026-12-03", total: 200, paid: 0, updatedAt: 2000 },
    { id: "g-2", structureId: "S1", roomTypeId: "RT1", groupId: "grp1", guestId: "G1", channel: "direct", status: "confirmed", checkIn: "2026-12-01", checkOut: "2026-12-03", total: 200, paid: 0, updatedAt: 3000 },
  ],
  guests: [{ id: "G1", fullName: "Anna Rossi" }],
});
const orgData = (): J => ({
  structures: [{ id: "SO", name: "Central Perk" }],
  bookings: [{ id: "bo-1", structureId: "SO", channel: "direct", status: "confirmed", checkIn: "2026-12-10", checkOut: "2026-12-12", total: 400, paid: 0, updatedAt: 7000 }],
});

interface Hooks {
  /** Eseguito subito prima di ogni UPDATE su public.entities (per simulare una scrittura concorrente). */
  beforeUpdate?: (db: FakeEntitiesDb) => void;
  /** Risposta forzata alla lettura di entity_authority. */
  authority?: { error?: { code?: string; message: string }; throws?: string };
  /** Se impostato, ogni UPDATE su public.entities restituisce questo errore. */
  updateError?: string;
}
function world(opts: { auth?: { owner: string; ot?: "u" | "o"; kind: string; authority: string }[]; authTable?: boolean; hooks?: Hooks } = {}) {
  W._resetWriteState();
  const rows = [...entityRowsFromBlock({ type: "u", id: OWN }, personal()), ...entityRowsFromBlock({ type: "o", id: ORG }, orgData())];
  const tables: Record<string, J[]> = {
    entities: rows,
    app_state: [{ user_id: OWN, rev: 1, data: { [DATA_KEY]: JSON.stringify(personal()), "spigolestay:threads:v1": "{}" } }],
    org_state: [{ org_id: ORG, rev: 1, data: { [DATA_KEY]: JSON.stringify(orgData()) } }],
    memberships: [{ user_id: OWN, org_id: ORG, active: true }],
  };
  if (opts.authTable !== false) tables.entity_authority = (opts.auth ?? []).map((a) => ({ owner_type: a.ot ?? "u", owner_id: a.owner, kind: a.kind, authority: a.authority }));
  const { db, client } = makeFakeEntitiesDb(tables);
  const hooks = opts.hooks ?? {};
  const log: string[] = [];
  const base = client as { from: (t: string) => any };
  const admin = {
    from(table: string) {
      log.push(table);
      if (table === "entity_authority" && hooks.authority) {
        const h = hooks.authority;
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => { if (h.throws) throw new Error(h.throws); return { data: null, error: h.error ?? null }; } };
        return chain;
      }
      if (table === "entity_authority" && opts.authTable === false) {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: { code: "42P01", message: 'relation "public.entity_authority" does not exist' } }) };
        return chain;
      }
      const q = base.from(table);
      if (table === "entities" && (hooks.beforeUpdate || hooks.updateError)) {
        const orig = q.update.bind(q);
        q.update = (p: J) => {
          hooks.beforeUpdate?.(db);
          if (hooks.updateError) {
            const chain: any = { eq: () => chain, select: () => chain, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: hooks.updateError } }).then(res) };
            return chain;
          }
          return orig(p);
        };
      }
      return q;
    },
  };
  return { db, admin: admin as never, log };
}
const TABLE_BOOKINGS = [{ owner: OWN, kind: "bookings", authority: "table" }];
const row = (db: FakeEntitiesDb, id: string, ot = "u"): J => db.tables.entities.find((r) => r.id === id && r.owner_type === ot) as J;
const updates = (db: FakeEntitiesDb) => db.log.filter((l) => l.op === "update" && l.table === "entities").length;
const blobUpdates = (db: FakeEntitiesDb) => db.log.filter((l) => l.op === "update" && (l.table === "app_state" || l.table === "org_state")).length;
async function withWrite<T>(v: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SERVER_WRITE_ENTITIES;
  if (v === undefined) delete process.env.SERVER_WRITE_ENTITIES; else process.env.SERVER_WRITE_ENTITIES = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.SERVER_WRITE_ENTITIES; else process.env.SERVER_WRITE_ENTITIES = prev; }
}
const on = <T,>(fn: () => Promise<T>) => withWrite("on", fn);
const patchB1 = (admin: never, extra: J = {}) => W.patchEntity(admin, { ownerType: "u", ownerId: OWN, kind: "bookings", id: "b-1", patch: { note: "ciao" }, ...extra });
const blobBookings = (db: FakeEntitiesDb): J[] => JSON.parse((db.tables.app_state[0].data as J)[DATA_KEY]).bookings;

// ───────────────────────── (a) niente scrittura: interruttore spento, tabella assente, riga assente, autorita' blob ─────────────────────────
test("interruttore spento (default): nessuna chiamata al database, handled:false", async () => {
  const w = world({ auth: TABLE_BOOKINGS }); // anche con l'autorita' 'table' in tabella, l'interruttore spento vince
  for (const v of [undefined, "off", "", "compare", "1"]) {
    const r = await withWrite(v, () => patchB1(w.admin));
    assert.deepEqual(r, { handled: false, reason: "disabled" }, String(v));
  }
  assert.equal(w.log.length, 0, "nessuna chiamata a nessuna tabella");
  assert.equal(updates(w.db), 0);
});

test("tabella entity_authority assente: handled:false, nessuna scrittura; l'errore si ricorda per un minuto", async () => {
  const w = world({ authTable: false });
  const r = await on(() => patchB1(w.admin));
  assert.deepEqual(r, { handled: false, reason: "authority_missing_table" });
  const r2 = await on(() => patchB1(w.admin));
  assert.deepEqual(r2, { handled: false, reason: "authority_missing_table" });
  assert.equal(w.log.filter((t) => t === "entity_authority").length, 1, "la seconda volta non richiede di nuovo la tabella assente");
  assert.equal(updates(w.db), 0);
  assert.equal(row(w.db, "b-1").data.note, undefined);
});

test("riga assente o autorita' 'blob' (o valore sconosciuto): handled:false, nessuna scrittura", async () => {
  for (const auth of [[], [{ owner: OWN, kind: "bookings", authority: "blob" }], [{ owner: OWN, kind: "bookings", authority: "Table " }], [{ owner: OWN, kind: "guests", authority: "table" }], [{ owner: "altro", kind: "bookings", authority: "table" }], [{ owner: OWN, ot: "o" as const, kind: "bookings", authority: "table" }]]) {
    const w = world({ auth });
    const r = await on(() => patchB1(w.admin));
    assert.deepEqual(r, { handled: false, reason: "authority_blob" }, JSON.stringify(auth));
    assert.equal(updates(w.db), 0);
  }
});

test("ingresso non valido: handled:false (kind sconosciuto, ne' patch ne' mutate, entrambi)", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const a = w.admin;
  await on(async () => {
    assert.deepEqual(await W.patchEntity(a, { ownerType: "u", ownerId: OWN, kind: "rates", id: "x", patch: {} }), { handled: false, reason: "bad_input" });
    assert.deepEqual(await W.patchEntity(a, { ownerType: "u", ownerId: OWN, kind: "bookings", id: "b-1" }), { handled: false, reason: "bad_input" });
    assert.deepEqual(await W.patchEntity(a, { ownerType: "u", ownerId: OWN, kind: "bookings", id: "b-1", patch: {}, mutate: (c) => c }), { handled: false, reason: "bad_input" });
    assert.deepEqual(await W.patchEntity(a, { ownerType: "x" as never, ownerId: OWN, kind: "bookings", id: "b-1", patch: {} }), { handled: false, reason: "bad_input" });
  });
  assert.equal(updates(w.db), 0);
});

// ───────────────────────── (c) errori: mai una richiesta rotta ─────────────────────────
test("errore nel leggere l'autorita' (errore del database o eccezione) con interruttore ACCESO: read_error, fail-closed (nessuna scrittura, il blocco non e' una verita' certa)", async () => {
  const w1 = world({ hooks: { authority: { error: { code: "XX000", message: "boom" } } } });
  const r1 = await on(() => patchB1(w1.admin)) as J;
  assert.equal(r1.handled, true); assert.equal(r1.ok, false); assert.equal(r1.error, "read_error"); assert.match(r1.message, /boom/);
  const w2 = world({ hooks: { authority: { throws: "rete caduta" } } });
  const r2 = await on(() => patchB1(w2.admin)) as J;
  assert.equal(r2.handled, true); assert.equal(r2.error, "read_error");
  assert.equal(updates(w1.db) + updates(w2.db), 0);
  // interruttore spento: nessuna lettura dell'autorita', quindi nessun errore possibile (fail-open per costruzione)
  assert.deepEqual(await withWrite(undefined, () => patchB1(w1.admin)), { handled: false, reason: "disabled" });
});

test("errore del database sulla scrittura con autorita' 'table': ok:false write_error, senza lanciare e senza ripiego sul blocco", async () => {
  const w = world({ auth: TABLE_BOOKINGS, hooks: { updateError: "disco pieno" } });
  const r = await on(() => patchB1(w.admin));
  assert.equal(r.handled, true);
  assert.ok(!(r as J).ok);
  assert.equal((r as J).error, "write_error");
  assert.match(String((r as J).message), /disco pieno/);
  assert.equal(blobUpdates(w.db), 0, "il blocco non viene toccato");
});

test("la funzione mutate che lancia un errore non rompe la richiesta", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const r = await on(() => W.patchEntity(w.admin, { ownerType: "u", ownerId: OWN, kind: "bookings", id: "b-1", mutate: () => { throw new Error("bug"); } }));
  assert.equal(r.handled, true);
  assert.equal((r as J).ok, false);
  assert.equal((r as J).error, "write_error");
});

// ───────────────────────── (b) autorita' 'table': scrittura con compare-and-set ─────────────────────────
test("table: patch aggiorna la riga, alza updated_ms, ricalcola le colonne di comodo, non tocca le altre righe ne' il blocco", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const before = JSON.parse(JSON.stringify(w.db.tables.entities));
  const r = await on(() => patchB1(w.admin, { patch: { note: "ciao", status: "cancelled", checkOut: "2026-11-14", updatedAt: 5000 } }));
  assert.equal(r.handled, true);
  assert.equal((r as J).ok, true);
  assert.equal((r as J).changed, true);
  const b = row(w.db, "b-1");
  assert.equal(b.data.note, "ciao");
  assert.equal(b.data.paid, 100, "i campi non indicati restano");
  assert.equal(b.updated_ms, 5000);
  assert.equal(b.data.updatedAt, 5000, "colonna e dato coincidono");
  assert.equal(b.status, "cancelled");
  assert.equal(b.check_out, "2026-11-14");
  assert.equal(b.check_in, "2026-11-10");
  assert.equal(b.structure_id, "S1");
  assert.equal(b.channel, "direct");
  assert.equal(typeof b.synced_at, "string");
  // nient'altro e' cambiato
  const after = w.db.tables.entities;
  for (let i = 0; i < before.length; i++) if (before[i].id !== "b-1") assert.deepEqual(after[i], before[i]);
  assert.equal(blobUpdates(w.db), 0);
  assert.equal(JSON.parse((w.db.tables.app_state[0].data as J)[DATA_KEY]).bookings[0].note, undefined);
});

test("table: il timbro e' sempre crescente (anche con orologio indietro o senza updatedAt nella patch)", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const r = await on(() => patchB1(w.admin, { now: 10 })); // adesso < precedente (1000)
  assert.equal((r as J).updatedMs, 1001);
  assert.equal(row(w.db, "b-1").updated_ms, 1001);
  const r2 = await on(() => patchB1(w.admin, { patch: { note: "due" }, now: 9_000_000 }));
  assert.equal((r2 as J).updatedMs, 9_000_000);
});

test("table: mutate sulla copia; null = niente da scrivere; contenuto uguale = nessuna scrittura", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const none = await on(() => W.patchEntity(w.admin, { ownerType: "u", ownerId: OWN, kind: "bookings", id: "b-1", mutate: () => null }));
  assert.deepEqual(none, { handled: true, ok: true, changed: false, updatedMs: 1000 });
  const same = await on(() => W.patchEntity(w.admin, { ownerType: "u", ownerId: OWN, kind: "bookings", id: "b-1", mutate: (c) => ({ ...c, updatedAt: 99999 }) }));
  assert.equal((same as J).changed, false);
  assert.equal(updates(w.db), 0);
  const ch = await on(() => W.patchEntity(w.admin, { ownerType: "u", ownerId: OWN, kind: "bookings", id: "b-1", mutate: (c) => { (c as J).paid = 250; return c; } }));
  assert.equal((ch as J).changed, true);
  assert.equal(row(w.db, "b-1").data.paid, 250);
});

test("table: riga inesistente => not_found", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const r = await on(() => W.patchEntity(w.admin, { ownerType: "u", ownerId: OWN, kind: "bookings", id: "non-c-e", patch: { a: 1 } }));
  assert.deepEqual(r, { handled: true, ok: false, error: "not_found" });
});

test("table: expectUpdatedMs diverso => conflict chiaro e nessuna scrittura; uguale => scrive", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const bad = await on(() => patchB1(w.admin, { expectUpdatedMs: 999 }));
  assert.deepEqual(bad, { handled: true, ok: false, error: "conflict", currentUpdatedMs: 1000 });
  assert.equal(updates(w.db), 0);
  const good = await on(() => patchB1(w.admin, { expectUpdatedMs: 1000 }));
  assert.equal((good as J).ok, true);
  assert.equal(row(w.db, "b-1").data.note, "ciao");
});

test("table: scrittura concorrente tra lettura e scrittura => il compare-and-set la intercetta e si riapplica su dati freschi", async () => {
  let bumped = 0;
  const w = world({
    auth: TABLE_BOOKINGS,
    hooks: { beforeUpdate: (db) => { if (bumped++ === 0) { const r = db.tables.entities.find((x) => x.id === "b-1") as J; r.data = { ...r.data, paid: 500, updatedAt: 1500 }; r.updated_ms = 1500; } } },
  });
  let seen = 0;
  const r = await on(() => W.patchEntity(w.admin, { ownerType: "u", ownerId: OWN, kind: "bookings", id: "b-1", mutate: (c) => { seen++; return { ...c, paid: Number(c.paid) + 10 }; } }));
  assert.equal((r as J).ok, true);
  assert.equal(seen, 2, "la funzione e' rieseguita sulla riga fresca");
  assert.equal(row(w.db, "b-1").data.paid, 510, "la scrittura dell'altro non e' persa");
  assert.ok(row(w.db, "b-1").updated_ms > 1500);
});

test("table: conflitto che non passa mai => errore 'conflict' dopo 3 tentativi; con expectUpdatedMs non si ritenta", async () => {
  let n = 0;
  const w = world({ auth: TABLE_BOOKINGS, hooks: { beforeUpdate: (db) => { n++; const r = db.tables.entities.find((x) => x.id === "b-1") as J; r.updated_ms = Number(r.updated_ms) + 1; } } });
  const r = await on(() => patchB1(w.admin));
  assert.equal((r as J).ok, false);
  assert.equal((r as J).error, "conflict");
  assert.equal(n, 3);
  n = 0;
  const cur = Number(row(w.db, "b-1").updated_ms);
  const r2 = await on(() => patchB1(w.admin, { expectUpdatedMs: cur }));
  assert.equal((r2 as J).error, "conflict");
  assert.equal(n, 1);
});

test("table: org (owner_type 'o') e kind diversi", async () => {
  const w = world({ auth: [{ owner: ORG, ot: "o", kind: "bookings", authority: "table" }, { owner: ORG, ot: "o", kind: "structures", authority: "table" }] });
  const r = await on(() => W.patchEntity(w.admin, { ownerType: "o", ownerId: ORG, kind: "bookings", id: "bo-1", patch: { paid: 400 } }));
  assert.equal((r as J).ok, true);
  assert.equal(row(w.db, "bo-1", "o").data.paid, 400);
  const s = await on(() => W.patchEntity(w.admin, { ownerType: "o", ownerId: ORG, kind: "structures", id: "SO", patch: { name: "Nuovo" } }));
  assert.equal((s as J).ok, true);
  assert.equal(row(w.db, "SO", "o").structure_id, "SO", "una struttura non ha structureId nel dato: la colonna resta com'era");
  assert.equal(row(w.db, "SO", "o").data.name, "Nuovo");
});

// ───────────────────────── mutateBookingScope (gruppi, scrittori non migrati) ─────────────────────────
const store = (): any => ({ table: "app_state", keyCol: "user_id", keyVal: OWN, blob: {}, data: {}, rev: 1, booking: { id: "g-1" }, bookingIndex: 0, structure: null, roomType: null, guest: null, ownerId: "", sid: "S1" });
const payGroup = (data: J) => { // come il pagamento di gruppo: segna tutte le camere del gruppo
  const bs = data.bookings as J[];
  bs.forEach((b) => { b.paid = 50; b.paidSessions = ["cs_1"]; });
  return true;
};

test("mutateStore + scope: gruppo di camere scritto sulle righe, camera con structure nel contesto, blocco intatto", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  let seenStruct = "";
  const ok = await on(() => MB.mutateStore(w.admin, store(), (data: J, idx: number) => { seenStruct = String(data.structures?.[0]?.name); assert.equal(idx, 0); assert.equal(data.bookings[0].id, "g-1"); assert.deepEqual(data.bookings.map((b: J) => b.id).sort(), ["g-1", "g-2"]); return payGroup(data); }, { tables: "scope" }));
  assert.equal(ok, true);
  assert.equal(seenStruct, "Casa");
  assert.equal(row(w.db, "g-1").data.paid, 50);
  assert.equal(row(w.db, "g-2").data.paid, 50);
  assert.equal(row(w.db, "b-1").data.paid, 100, "fuori dal gruppo: intatta");
  assert.ok(row(w.db, "g-1").updated_ms > 2000 && row(w.db, "g-2").updated_ms > 3000);
  assert.equal(blobUpdates(w.db), 0);
});

test("mutateStore + scope: se la seconda riga va in conflitto la prima viene rimessa com'era e si riporta l'errore", async () => {
  let n = 0;
  const w = world({ auth: TABLE_BOOKINGS, hooks: { beforeUpdate: (db) => { n++; if (n === 2 || n === 4) { const r = db.tables.entities.find((x) => x.id === "g-2") as J; r.updated_ms = Number(r.updated_ms) + 1; } } } });
  // n=1: scrive g-1; n=2: g-2 in conflitto (+ ripristino di g-1 = n=3); poi secondo tentativo: n=4 g-1 ok, n=5 g-2... forziamo anche il secondo conflitto
  const ok = await on(() => MB.mutateStore(w.admin, store(), (data: J) => payGroup(data), { tables: "scope" }));
  assert.equal(ok, false);
  assert.equal(row(w.db, "g-1").data.paid, 0, "la prima camera e' stata ripristinata");
  assert.equal(row(w.db, "g-1").data.paidSessions, undefined);
});

test("mutateStore + scope: la funzione che ritorna false = nessuna scrittura (come oggi)", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const ok = await on(() => MB.mutateStore(w.admin, store(), () => false, { tables: "scope" }));
  assert.equal(ok, false);
  assert.equal(updates(w.db), 0);
});

test("mutateStore + scope: una funzione che tocca altro (altre collezioni, righe aggiunte) non scrive nulla: unsupported_shape", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const r1 = await on(() => W.mutateBookingScope(w.admin, { ownerType: "u", ownerId: OWN, bookingId: "b-1", supported: true, mutate: (d: J) => { d.guests = [{ id: "x" }]; d.bookings[0].paid = 1; return true; } }));
  assert.deepEqual(r1, { handled: true, ok: false, error: "unsupported_shape" });
  const r2 = await on(() => W.mutateBookingScope(w.admin, { ownerType: "u", ownerId: OWN, bookingId: "b-1", supported: true, mutate: (d: J) => { d.bookings.push({ id: "nuovo" }); return true; } }));
  assert.equal((r2 as J).error, "unsupported_shape");
  const r3 = await on(() => W.mutateBookingScope(w.admin, { ownerType: "u", ownerId: OWN, bookingId: "b-1", supported: true, mutate: (d: J) => { d.structures[0].name = "x"; return true; } }));
  assert.equal((r3 as J).error, "unsupported_shape");
  assert.equal(updates(w.db), 0);
});

test("mutateStore senza opzioni (scrittore non ancora migrato, es. /api/checkin) con autorita' 'table': rifiuta e NON scrive il blocco", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const ok = await on(() => MB.mutateStore(w.admin, store(), (d: J) => { d.bookings[0].paid = 9; return true; }));
  assert.equal(ok, false);
  assert.equal(updates(w.db), 0);
  assert.equal(blobUpdates(w.db), 0);
});

// ───────────────────────── i punti di scrittura reali: percorso del blocco invariato ─────────────────────────
test("writeBookingPatch / mutateStore: interruttore spento, tabella assente o autorita' blob => il blocco e' scritto come sempre", async () => {
  for (const [label, v, o] of [["spento", undefined, { auth: TABLE_BOOKINGS }], ["tabella assente", "on", { authTable: false }], ["blob", "on", { auth: [{ owner: OWN, kind: "bookings", authority: "blob" }] }]] as const) {
    const w = world(o as never);
    const s = store(); s.blob = (w.db.tables.app_state[0].data as J); s.data = JSON.parse(s.blob[DATA_KEY]); s.booking = { id: "b-1" }; s.bookingIndex = 0;
    const okPatch = await withWrite(v, () => MB.writeBookingPatch(w.admin, s, { note: "n1", updatedAt: 5 }));
    assert.equal(okPatch, true, label);
    assert.equal(blobBookings(w.db)[0].note, "n1", label);
    assert.equal(blobUpdates(w.db), 1, label);
    assert.equal(updates(w.db), 0, label + ": public.entities non scritta");
    const s2 = store(); s2.blob = (w.db.tables.app_state[0].data as J); s2.data = JSON.parse(s2.blob[DATA_KEY]); s2.rev = w.db.tables.app_state[0].rev; s2.booking = { id: "b-1" }; s2.bookingIndex = 0;
    const okMut = await withWrite(v, () => MB.mutateStore(w.admin, s2, (d: J) => { d.bookings[0].paid = 77; return true; }, { tables: "scope" }));
    assert.equal(okMut, true, label);
    assert.equal(blobBookings(w.db)[0].paid, 77, label);
    assert.equal(updates(w.db), 0, label);
  }
});

test("writeBookingPatch con autorita' 'table': aggiorna la riga e NON il blocco; conflitto => false", async () => {
  const w = world({ auth: TABLE_BOOKINGS });
  const s = store(); s.booking = { id: "b-1" };
  assert.equal(await on(() => MB.writeBookingPatch(w.admin, s, { changeRequest: { at: 1 }, updatedAt: 4000 })), true);
  assert.deepEqual(row(w.db, "b-1").data.changeRequest, { at: 1 });
  assert.equal(row(w.db, "b-1").updated_ms, 4000);
  assert.equal(blobUpdates(w.db), 0);
  const w2 = world({ auth: TABLE_BOOKINGS, hooks: { beforeUpdate: (db) => { const r = db.tables.entities.find((x) => x.id === "b-1") as J; r.updated_ms = Number(r.updated_ms) + 1; } } });
  assert.equal(await on(() => MB.writeBookingPatch(w2.admin, s, { note: "x" })), false);
  assert.equal(blobUpdates(w2.db), 0);
});

test("riconciliazione Stripe: con autorita' 'table' riscrive la riga; altrimenti il blocco come sempre", async () => {
  // blocco (default)
  const a = world({ auth: TABLE_BOOKINGS });
  const resOff = await withWrite(undefined, () => SR.reconcileCharge(a.admin, { amount: 30000, amount_refunded: 10000, metadata: { uid: OWN } }, "pi_1", false));
  assert.equal(resOff, "ok");
  assert.equal(blobBookings(a.db)[0].paid, 0, "il blocco e' stato riconciliato");
  assert.equal(updates(a.db), 0);
  // tabella
  const b = world({ auth: TABLE_BOOKINGS });
  const res = await on(() => SR.reconcileCharge(b.admin, { amount: 30000, amount_refunded: 10000, metadata: { uid: OWN } }, "pi_1", false));
  assert.equal(res, "ok");
  assert.equal(row(b.db, "b-1").data.paid, 0, "la riga e' stata riconciliata");
  assert.deepEqual(row(b.db, "b-1").data.stripeRefundedCents, { pi_1: 10000 });
  assert.equal(blobUpdates(b.db), 0);
  // ripetuta: gia' riconciliata, nessuna nuova scrittura
  const n = updates(b.db);
  assert.equal(await on(() => SR.reconcileCharge(b.admin, { amount: 30000, amount_refunded: 10000, metadata: { uid: OWN } }, "pi_1", false)), "ok");
  assert.equal(updates(b.db), n);
  // payment intent sconosciuto: nessuna riga -> none
  assert.equal(await on(() => SR.reconcileCharge(b.admin, { amount: 1, amount_refunded: 1, metadata: { uid: OWN } }, "pi_zzz", false)), "none");
});

test("markReviewRequested: table = riga aggiornata una sola volta; blob/tabella assente = blocco come sempre", async () => {
  const a = world({ auth: TABLE_BOOKINGS });
  assert.equal(await on(() => AT.markReviewRequested(a.admin, { table: "app_state", keyCol: "user_id", keyVal: OWN }, "b-1", "email")), true);
  assert.equal(typeof row(a.db, "b-1").data.reviewRequestedAt, "number");
  assert.equal(row(a.db, "b-1").data.reviewRequestChannel, "email");
  assert.equal(blobUpdates(a.db), 0);
  const first = row(a.db, "b-1").data.reviewRequestedAt;
  assert.equal(await on(() => AT.markReviewRequested(a.admin, { table: "app_state", keyCol: "user_id", keyVal: OWN }, "b-1", "whatsapp")), true);
  assert.equal(row(a.db, "b-1").data.reviewRequestedAt, first, "gia' segnata: non si riscrive");
  assert.equal(row(a.db, "b-1").data.reviewRequestChannel, "email");

  const b = world({ authTable: false });
  assert.equal(await on(() => AT.markReviewRequested(b.admin, { table: "app_state", keyCol: "user_id", keyVal: OWN }, "b-1", "email")), true);
  assert.equal(typeof blobBookings(b.db)[0].reviewRequestedAt, "number");
  assert.equal(updates(b.db), 0);
});
