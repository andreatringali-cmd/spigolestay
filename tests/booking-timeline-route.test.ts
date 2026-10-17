import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Route /api/booking-timeline con un database finto: accesso solo alla propria prenotazione, solo righe di QUELLA prenotazione,
// tabelle illeggibili non fanno cadere la risposta, tetto di 200 eventi.
register("./helpers/checkin-route-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, unknown[]>; admin?: unknown; operator?: boolean; operatorId?: string } };
G.__stubs = { calls: {} };
const route = await import("../src/app/api/booking-timeline/route.ts");

type Row = Record<string, unknown>;
type Db = { tables: Record<string, Row[]>; broken: Set<string> };

// Mini finto Supabase (solo select/eq/in/order/limit/maybeSingle): basta alla route.
function fake(db: Db) {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let ord: { col: string; asc: boolean } | null = null; let lim = Infinity;
    const q = {
      select() { return q; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
      in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return q; },
      order(c: string, o?: { ascending?: boolean }) { ord = { col: c, asc: o?.ascending !== false }; return q; },
      limit(n: number) { lim = n; return q; },
      async maybeSingle() { const r = run(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error }; },
      then(res: (v: { data: unknown; error: { message: string } | null }) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
    };
    const run = (): { data: unknown; error: { message: string } | null } => {
      if (db.broken.has(table)) return { data: null, error: { message: "relation does not exist" } };
      let rows = (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => structuredClone(r));
      if (ord) { const { col, asc } = ord; rows = rows.sort((a, z) => (String(a[col]) < String(z[col]) ? -1 : 1) * (asc ? 1 : -1)); }
      return { data: rows.slice(0, lim), error: null };
    };
    return q;
  };
  return { from };
}

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const B1 = "b1111111-1111-4111-8111-111111111111";
const B2 = "b2222222-2222-4222-8222-222222222222";
const DATA_KEY = "spigolestay:data:v1";
const state = (bookings: Row[]) => ({ [DATA_KEY]: JSON.stringify({ bookings, guests: [], structures: [], roomTypes: [] }) });

function setup(extra: Partial<Db["tables"]> = {}, broken: string[] = []) {
  const db: Db = {
    tables: {
      app_state: [
        { user_id: ME, rev: 1, data: state([{ id: B1, structureId: "s1", guestId: "g1", extId: "channex:CHX-1" }]) },
        { user_id: OTHER, rev: 1, data: state([{ id: B2, structureId: "s2", guestId: "g2", extId: "channex:CHX-2" }]) },
      ],
      org_state: [], memberships: [], channex_map: [],
      invii_log: [], auto_message_log: [], channex_bookings: [], booking_events: [], alloggiati_schedine: [], istat_rows: [], documents: [],
      ...extra,
    },
    broken: new Set(broken),
  };
  Object.assign(G.__stubs, { admin: fake(db), operator: true, operatorId: ME });
  return db;
}
async function call(body: unknown) {
  const res = (await route.POST(new Request("https://xenora.test/api/booking-timeline", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: typeof body === "string" ? body : JSON.stringify(body) }))) as unknown as { status?: number; __resp?: boolean; json?: () => Promise<any>; body?: any };
  return { status: res.status ?? 0, body: res.__resp ? null : await res.json!() };
}

test("senza accesso risponde come authTenant (nessuna lettura)", async () => {
  setup();
  G.__stubs.operator = false;
  const res = (await route.POST(new Request("https://xenora.test/x", { method: "POST", body: "{}" }))) as unknown as { __resp?: boolean; status: number };
  assert.equal(res.__resp, true);
  assert.equal(res.status, 401);
});

test("id mancante o troppo lungo: 400", async () => {
  setup();
  assert.equal((await call({})).status, 400);
  assert.equal((await call("non json")).status, 400);
  assert.equal((await call({ bookingId: "x".repeat(101) })).status, 400);
});

test("la prenotazione di un altro utente non si legge (404) e nessuna riga di log viene toccata", async () => {
  setup({ invii_log: [{ ref: B2, tenant_id: OTHER, job: "messaggi", channel: "email", ok: true, detail: "x", at: "2026-10-14T09:00:00Z" }] });
  const r = await call({ bookingId: B2 });
  assert.equal(r.status, 404);
  assert.match(r.body.message, /non trovata/);
  assert.equal(r.body.events, undefined);
});

test("legge solo le righe di QUELLA prenotazione e dei tenant dello store", async () => {
  setup({
    invii_log: [
      { ref: B1, tenant_id: ME, job: "messaggi", channel: "email", ok: true, detail: "Benvenuto → a@b.it", at: "2026-10-14T09:00:00Z" },
      { ref: B1, tenant_id: ME, job: "pulizie", channel: "whatsapp", ok: true, detail: "x", at: "2026-10-14T09:01:00Z" },
      { ref: B1, tenant_id: ME, job: "ota_msg", channel: "email", ok: true, detail: "x", at: "2026-10-14T09:02:00Z" },
      { ref: B1, tenant_id: OTHER, job: "messaggi", channel: "email", ok: true, detail: "di un altro tenant", at: "2026-10-14T09:03:00Z" },
      { ref: B2, tenant_id: ME, job: "messaggi", channel: "email", ok: true, detail: "altra prenotazione", at: "2026-10-14T09:04:00Z" },
    ],
    auto_message_log: [{ booking_id: B1, tenant_id: ME, template_id: "t1", slot_date: "2026-10-14", sent_at: "2026-10-14T09:00:01Z" }, { booking_id: B2, tenant_id: ME, template_id: "t9", slot_date: "2026-10-14", sent_at: "2026-10-14T09:00:01Z" }],
    channex_bookings: [
      { booking_id: "CHX-1", tenant_id: ME, revision_id: "r1", status: "new", ota_reservation_code: "123", imported_at: "2026-10-01T08:00:00Z" },
      { booking_id: "CHX-1", tenant_id: OTHER, revision_id: "r2", status: "modified", ota_reservation_code: "999", imported_at: "2026-10-02T08:00:00Z" },
      { booking_id: "CHX-2", tenant_id: OTHER, revision_id: "r3", status: "new", imported_at: "2026-10-02T08:00:00Z" },
    ],
    booking_events: [{ booking_id: B1, tenant_id: ME, ts: "2026-10-16T08:00:00Z", kind: "schedina", message: "Schedina Alloggiati inviata alla Questura" }, { booking_id: B2, tenant_id: OTHER, ts: "2026-10-16T08:00:00Z", kind: "istat", message: "x" }],
    alloggiati_schedine: [{ booking_id: B1, tenant_id: ME, stato: "da_validare", errors: ["Luogo di nascita mancante", "Altro"], updated_at: "2026-10-15T08:00:00Z" }],
    istat_rows: [{ booking_id: B1, tenant_id: ME, stato: "sent", updated_at: "2026-10-17T08:00:00Z" }],
    documents: [{ booking_id: B1, tenant_id: ME, doc_kind: "fattura", number_label: "1/2026", stato: "emessa", created_at: "2026-10-18T08:00:00Z", issued_at: "2026-10-18T08:05:00Z", sent_at: null, delivered_at: null, updated_at: "2026-10-18T08:05:00Z" }],
  });
  const r = await call({ bookingId: B1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.partial, undefined);
  const ev = r.body.events as Row[];
  const by = (src: string) => ev.filter((e) => e.src === src);
  assert.deepEqual(by("invii_log").map((e) => e.job), ["messaggi"]);
  assert.equal(by("auto_message_log").length, 1);
  assert.deepEqual(by("channex_bookings").map((e) => e.otaCode), ["123"]);
  assert.equal(by("booking_events").length, 1);
  assert.equal(by("alloggiati_schedine")[0].errorCount, 2);
  assert.equal(by("alloggiati_schedine")[0].firstError, "Luogo di nascita mancante");
  assert.equal(by("istat_rows").length, 1);
  assert.deepEqual(by("documents").map((e) => e.step), ["issued"]);
  // ordine: dal più recente
  const times = ev.map((e) => Date.parse(String(e.at)));
  assert.deepEqual(times, [...times].sort((a, z) => z - a));
  // i dati personali grezzi non escono (solo le colonne scelte): nessun tenant_id nelle righe
  assert.equal(ev.some((e) => "tenant_id" in e || "tenantId" in e), false);
});

test("tabella illeggibile: risposta ok con `partial`, le altre fonti restano", async () => {
  setup({ booking_events: [{ booking_id: B1, tenant_id: ME, ts: "2026-10-16T08:00:00Z", kind: "istat", message: "Movimento ISTAT inviato" }] }, ["invii_log", "documents"]);
  const r = await call({ bookingId: B1 });
  assert.equal(r.status, 200);
  assert.deepEqual([...r.body.partial].sort(), ["documents", "invii_log"]);
  assert.equal(r.body.events.length, 1);
});

test("struttura condivisa: il socio vede la prenotazione dell'organizzazione e le righe scritte dal titolare", async () => {
  const OWNER = "44444444-4444-4444-8444-444444444444";
  const db = setup({
    org_state: [{ org_id: ORG, rev: 1, data: state([{ id: B2, structureId: "s2", guestId: "g2", groupId: "grp", extId: "channex:CHX-9" }, { id: "b3", structureId: "s2", guestId: "g2", groupId: "grp" }]) }],
    memberships: [{ user_id: ME, org_id: ORG, role: "member", active: true }, { user_id: OWNER, org_id: ORG, role: "owner", active: true }],
    invii_log: [
      { ref: B2, tenant_id: OWNER, job: "checkin", channel: "email", ok: true, detail: "promemoria check-in → x@y.it", at: "2026-10-14T09:00:00Z" },
      { ref: "b3", tenant_id: OWNER, job: "messaggi", channel: "email", ok: true, detail: "Guida → x@y.it", at: "2026-10-14T10:00:00Z" },
      { ref: B2, tenant_id: OTHER, job: "messaggi", channel: "email", ok: true, detail: "estraneo", at: "2026-10-14T11:00:00Z" },
    ],
    auto_message_log: [{ booking_id: B2, tenant_id: ORG, template_id: "t1", slot_date: "2026-10-14", sent_at: "2026-10-14T09:00:01Z" }],
    channex_map: [{ org_id: ORG, tenant_id: OWNER }],
    channex_bookings: [{ booking_id: "CHX-9", tenant_id: OWNER, revision_id: "r9", status: "new", imported_at: "2026-10-01T08:00:00Z" }],
  });
  void db;
  const r = await call({ bookingId: B2 });
  assert.equal(r.status, 200);
  const ev = r.body.events as Row[];
  assert.equal(ev.filter((e) => e.src === "invii_log").length, 2); // la camera del gruppo conta, il tenant estraneo no
  assert.equal(ev.filter((e) => e.src === "auto_message_log").length, 1);
  assert.equal(ev.filter((e) => e.src === "channex_bookings").length, 1);
});

test("tetto di 200 eventi, restano i più recenti", async () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ ref: B1, tenant_id: ME, job: "messaggi", channel: "email", ok: true, detail: `T${i} → a@b.it`, at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString() }));
  // La route legge al massimo 120 righe per tabella: con 300 righe si prendono le 120 più recenti, mai oltre 200 in totale.
  setup({ invii_log: rows });
  const r = await call({ bookingId: B1 });
  assert.equal(r.status, 200);
  assert.ok(r.body.events.length <= 200);
  assert.equal(r.body.events[0].detail, "T299 → a@b.it");
});

test("channex_bookings: solo righe di property dell'utente; tenant nullo senza property e property altrui scartati", async () => {
  setup({
    channex_map: [{ tenant_id: ME, org_id: null, channex_property_id: "P-ME" }, { tenant_id: OTHER, org_id: null, channex_property_id: "P-OTHER" }],
    channex_bookings: [
      { booking_id: "CHX-1", tenant_id: ME, channex_property_id: "P-ME", revision_id: "ok1", status: "new", imported_at: "2026-10-01T08:00:00Z" },
      { booking_id: "CHX-1", tenant_id: null, channex_property_id: "P-ME", revision_id: "ok2", status: "modified", imported_at: "2026-10-02T08:00:00Z" },   // tenant nullo ma property mia
      { booking_id: "CHX-1", tenant_id: null, channex_property_id: null, revision_id: "no1", status: "modified", imported_at: "2026-10-03T08:00:00Z" },        // tenant nullo e nessuna property
      { booking_id: "CHX-1", tenant_id: ME, channex_property_id: "P-OTHER", revision_id: "no2", status: "modified", imported_at: "2026-10-04T08:00:00Z" },    // property di un altro
      { booking_id: "CHX-1", tenant_id: ME, channex_property_id: null, revision_id: "ok3", status: "modified", imported_at: "2026-10-05T08:00:00Z" },         // vecchia riga senza property, tenant mio
    ],
  });
  const r = await call({ bookingId: B1 });
  assert.equal(r.status, 200);
  const ids = (r.body.events as Row[]).filter((e) => e.src === "channex_bookings").map((e) => e.revisionId).sort();
  assert.deepEqual(ids, ["ok1", "ok2", "ok3"]);
});

test("channex_bookings: oltre 120 righe restano le più recenti", async () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({ booking_id: "CHX-1", tenant_id: ME, channex_property_id: null, revision_id: `r${i}`, status: "modified", imported_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString() }));
  setup({ channex_bookings: rows });
  const r = await call({ bookingId: B1 });
  const ids = (r.body.events as Row[]).filter((e) => e.src === "channex_bookings").map((e) => e.revisionId);
  assert.equal(ids.length, 120);
  assert.ok(ids.includes("r149"));
  assert.ok(!ids.includes("r0"));
});
