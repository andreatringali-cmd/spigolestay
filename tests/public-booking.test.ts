import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// La route importa next/server, supabase-js, server-auth e pool-push: l'hook li sostituisce con finti (vedi tests/helpers/stubs-loader.mjs).
// Il client Supabase e' il finto in memoria; "internalFetch" (email di conferma) e "schedulePoolPush" registrano le chiamate in globalThis.__stubs.
register("./helpers/stubs-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; internal?: boolean; rateLimited?: boolean } };
G.__stubs = { calls: {} };
const { POST } = await import("../src/app/api/public-booking/route.ts");

const DATA_KEY = "spigolestay:data:v1";
const POOL_KEY = "spigolestay:inventorypool";
const calls = (k: string) => G.__stubs.calls[k] ?? [];
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const baseData = (over: Record<string, unknown> = {}) => ({
  structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", currency: "€" }],
  roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia", beds: 2, basePrice: 100 }],
  units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }, { id: "u2", roomTypeId: "rt-dbl", structureId: "st-1" }],
  guests: [] as any[], bookings: [] as any[], ...over,
});
const seed = (o: Record<string, unknown> = {}) => ({
  id: "b-0", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", status: "confirmed", checkIn: day(30), checkOut: day(33), channel: "direct", ...o,
});

function scenario(data: Record<string, unknown> = baseData(), opts: { blobExtra?: Record<string, string>; internal?: boolean; site?: boolean; orgData?: Record<string, unknown> } = {}) {
  const { db, client } = makeFakeDb({
    public_sites: opts.site === false ? [] : [{ slug: "casa-ortigia", user_id: "owner-1", structure_id: "st-1" }],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data), ...(opts.blobExtra ?? {}) } }],
    memberships: opts.orgData ? [{ user_id: "owner-1", org_id: "org-1" }] : [],
    org_state: opts.orgData ? [{ org_id: "org-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(opts.orgData) } }] : [],
  });
  Object.assign(G.__stubs, { calls: {}, admin: client, internal: !!opts.internal, rateLimited: false }); // si modifica l'oggetto in place: i finti lo hanno gia' agganciato
  return { db, state: () => JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]), orgState: () => JSON.parse((db.tables.org_state[0].data as any)[DATA_KEY]) };
}
const body = (o: Record<string, unknown> = {}) => ({
  slug: "casa-ortigia", rt: "rt-dbl", ci: day(30), co: day(33), adults: 2, children: 0, total: 300, token: "tok-1",
  guest: { firstName: "Giulia", lastName: "Rossi", email: "giulia.rossi@example.com", phone: "+393331112233", country: "IT" }, ...o,
});
async function post(b: Record<string, unknown> | string, headers: Record<string, string> = {}) {
  const req = new Request("https://xenora.test/api/public-booking", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers }, body: typeof b === "string" ? b : JSON.stringify(b) });
  const res = (await POST(req)) as unknown as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
}

// ───────────────────────── protezioni e validazione ─────────────────────────
test("senza configurazione Supabase: 503", async () => {
  scenario();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try { const r = await post(body()); assert.equal(r.status, 503); assert.equal(r.json.error, "supabase_not_configured"); }
  finally { process.env.NEXT_PUBLIC_SUPABASE_URL = url; }
});

test("troppe richieste dallo stesso IP: 429 e non si scrive nulla (le chiamate interne firmate non hanno il limite)", async () => {
  const sc = scenario();
  G.__stubs.rateLimited = true;
  const r = await post(body());
  assert.equal(r.status, 429); assert.equal(r.json.error, "troppe_richieste");
  assert.equal(sc.state().bookings.length, 0);
  G.__stubs.internal = true;
  assert.equal((await post(body())).status, 200);
});

test("richieste malformate: slug, tipologia o date mancanti/incoerenti = 400 bad_request", async () => {
  scenario();
  for (const o of [{ slug: "" }, { rt: "" }, { ci: "" }, { ci: "10/06/2026" }, { co: day(30) }, { co: day(25) }, { co: "boh" }]) {
    const r = await post(body(o));
    assert.equal(r.status, 400, JSON.stringify(o)); assert.equal(r.json.error, "bad_request");
  }
  const rotto = await post("{non json");
  assert.equal(rotto.status, 400);
});

test("date fuori misura dal sito anonimo: oltre 60 notti, nel passato, oltre 2 anni = 400 bad_dates", async () => {
  scenario();
  assert.equal((await post(body({ ci: day(30), co: day(91) }))).json.error, "bad_dates"); // 61 notti
  assert.equal((await post(body({ ci: day(-2), co: day(1) }))).json.error, "bad_dates");
  assert.equal((await post(body({ ci: day(800), co: day(802) }))).json.error, "bad_dates");
});

test("date: 60 notti esatte e arrivo ieri (tolleranza fusi) sono accettati", async () => {
  const sc = scenario();
  assert.equal((await post(body({ ci: day(30), co: day(90), total: undefined, token: "a" }))).status, 200);
  assert.equal((await post(body({ ci: day(-1), co: day(1), total: undefined, token: "b" }))).status, 200);
  assert.equal(sc.state().bookings.length, 2);
});

test("le chiamate interne (pagamento gia' avvenuto) non hanno il limite sulle date", async () => {
  const sc = scenario();
  G.__stubs.internal = true;
  assert.equal((await post(body({ ci: day(-10), co: day(100), total: 5000 }))).status, 200);
  assert.equal(sc.state().bookings.length, 1);
});

test("sito non trovato (slug sconosciuto) = 404", async () => {
  const sc = scenario(baseData(), { site: false });
  const r = await post(body());
  assert.equal(r.status, 404); assert.equal(r.json.error, "site_not_found");
  assert.equal(sc.state().bookings.length, 0);
});

// ───────────────────────── prenotazione riuscita ─────────────────────────
test("prenotazione dal sito: riga confermata, diretta, prima camera libera, ospite creato; nessun incasso ne' dato Stripe dall'anonimo", async () => {
  const sc = scenario();
  const r = await post(body({
    deposit: 150, refundable: true, stripePaymentIntent: "pi_FINTO", stripeSessionId: "cs_FINTO", stripeAccountId: "acct_FINTO", planName: "Flessibile", cancelDays: 7, note: "Arrivo tardi",
  }));
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  const b = sc.state().bookings[0];
  assert.equal(b.status, "confirmed"); assert.equal(b.channel, "direct"); assert.equal(b.unitId, "u1");
  assert.equal(b.structureId, "st-1"); assert.equal(b.roomTypeId, "rt-dbl");
  assert.equal(b.total, 300); assert.equal(b.adults, 2); assert.equal(b.children, 0);
  assert.equal(b.extId, "site:casa-ortigia:tok-1");
  assert.equal(b.note, "Arrivo tardi");
  assert.equal(b.paid, 0, "l'anonimo non puo' dichiarare un acconto");
  assert.equal(b.refundable, undefined);
  assert.equal(b.stripePaymentIntent, undefined); assert.equal(b.stripeSessionId, undefined); assert.equal(b.stripeAccountId, undefined);
  assert.equal(b.ratePlanName, "Flessibile"); assert.equal(b.cancelDays, 7);
  const g = sc.state().guests.find((x: any) => x.id === b.guestId);
  assert.equal(g.fullName, "Giulia Rossi"); assert.equal(g.email, "giulia.rossi@example.com");
});

test("chiamata interna (webhook Stripe): acconto, rimborsabilita' e riferimenti Stripe vengono salvati", async () => {
  const sc = scenario(baseData(), { internal: true });
  await post(body({ deposit: 150, refundable: true, stripePaymentIntent: "pi_FINTO", stripeSessionId: "cs_FINTO", stripeAccountId: "acct_FINTO", cancelDays: 7 }));
  const b = sc.state().bookings[0];
  assert.equal(b.paid, 150); assert.equal(b.refundable, true);
  assert.equal(b.stripePaymentIntent, "pi_FINTO"); assert.equal(b.stripeSessionId, "cs_FINTO"); assert.equal(b.stripeAccountId, "acct_FINTO");
});

test("idempotenza: lo stesso token due volte = una sola prenotazione ('already')", async () => {
  const sc = scenario();
  assert.equal((await post(body())).json.already, undefined);
  const r2 = await post(body());
  assert.equal(r2.status, 200); assert.equal(r2.json.already, true);
  assert.equal(sc.state().bookings.length, 1);
  assert.equal(sc.state().guests.length, 1);
  assert.equal(calls("internalFetch").length, 1, "una sola email di conferma");
});

test("ospite gia' presente (stessa email, maiuscole diverse) viene riusato", async () => {
  const sc = scenario(baseData({ guests: [{ id: "g-esist", fullName: "Giulia Rossi", email: "GIULIA.ROSSI@example.com" }] }));
  await post(body());
  assert.equal(sc.state().guests.length, 1);
  assert.equal(sc.state().bookings[0].guestId, "g-esist");
});

test("numeri sporchi: adulti non numerici = 1, bambini negativi = 0, totale oltre il milione limitato, eta' non numeriche scartate", async () => {
  const sc = scenario();
  await post(body({ adults: "abc", children: -3, total: 9_999_999_999, childAges: [4, "x", 7], token: "n1", ci: day(40), co: day(41) }));
  const b = sc.state().bookings[0];
  assert.equal(b.adults, 1); assert.equal(b.children, 0); assert.deepEqual(b.childAges, [4, 7]);
  assert.equal(b.total, 1_000_000);
});

// ───────────────────────── tetto di prezzo (50% del listino) ─────────────────────────
test("prezzo: sotto la meta' del listino = 400 price_mismatch, nulla viene scritto", async () => {
  const sc = scenario();
  const r = await post(body({ total: 149 })); // listino 3 x 100 = 300, minimo 150
  assert.equal(r.status, 400); assert.equal(r.json.error, "price_mismatch");
  assert.equal(sc.state().bookings.length, 0);
  assert.equal(sc.state().guests.length, 0, "nemmeno l'ospite");
});

test("prezzo: esattamente la meta' e sopra il listino sono accettati", async () => {
  const sc = scenario();
  assert.equal((await post(body({ total: 150, token: "t1" }))).status, 200);
  assert.equal((await post(body({ total: 5000, token: "t2", ci: day(40), co: day(43) }))).status, 200);
  assert.equal(sc.state().bookings.length, 2);
});

test("prezzo: un totale di 1 euro su un soggiorno da 2000 euro viene rifiutato", async () => {
  const d = baseData({ roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Suite", beds: 2, basePrice: 200 }] });
  const sc = scenario(d);
  const r = await post(body({ total: 1, ci: day(30), co: day(40) }));
  assert.equal(r.json.error, "price_mismatch");
  assert.equal(sc.state().bookings.length, 0);
});

test("prezzo: gli override del calendario entrano nel minimo (notte scontata a 40 -> minimo piu' basso)", async () => {
  const ov: Record<string, number> = {};
  for (let i = 30; i < 33; i++) ov[`rt-dbl|${day(i)}`] = 40; // 3 notti a 40 = 120 -> minimo 60
  const sc = scenario(baseData({ rateOverrides: ov }));
  assert.equal((await post(body({ total: 60 }))).status, 200);
  assert.equal(sc.state().bookings.length, 1);
  assert.equal((await post(body({ total: 59, token: "t2", ci: day(30), co: day(33) }))).json.error, "price_mismatch");
});

test("prezzo: le chiamate interne (gia' pagate) non hanno il controllo sul minimo", async () => {
  const sc = scenario(baseData(), { internal: true });
  assert.equal((await post(body({ total: 10 }))).status, 200);
  assert.equal(sc.state().bookings[0].total, 10);
});

test("prezzo: totale omesso (o 0) = nessun controllo e la prenotazione si salva senza totale", async () => {
  const sc = scenario();
  assert.equal((await post(body({ total: undefined, token: "o1" }))).status, 200);
  assert.equal((await post(body({ total: 0, token: "o2", ci: day(40), co: day(42) }))).status, 200);
  assert.deepEqual(sc.state().bookings.map((b: any) => b.total), [undefined, undefined]);
});

test("prezzo: un totale omesso aggira il tetto del 50%", { todo: "Da verificare con il titolare: omettendo 'total' l'anonimo salta stayFloor (public-booking/route.ts, `if (!internal && total !== undefined)`). Il totale non viene ricalcolato dal listino lato server, quindi la prenotazione resta senza prezzo." }, async () => {
  const sc = scenario();
  const r = await post(body({ total: undefined }));
  assert.equal(r.status === 200 && sc.state().bookings[0].total === undefined, false);
});

test("prezzo: struttura senza listino (prezzi a 0) = nessun controllo", async () => {
  const sc = scenario(baseData({ roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia", beds: 2, basePrice: 0 }] }));
  assert.equal((await post(body({ total: 5 }))).status, 200);
  assert.equal(sc.state().bookings.length, 1);
});

// ───────────────────────── disponibilita' e sovrapposizioni ─────────────────────────
test("camera occupata: viene scelta la prima libera; sovrapposizione parziale conta; check-out = check-in no", async () => {
  const sc = scenario(baseData({ bookings: [seed({ unitId: "u1", checkIn: day(28), checkOut: day(31) })] }));
  await post(body());
  assert.equal(sc.state().bookings[1].unitId, "u2");
  const sc2 = scenario(baseData({ bookings: [seed({ unitId: "u1", checkIn: day(27), checkOut: day(30) })] })); // l'altro parte il giorno in cui arriva
  await post(body());
  assert.equal(sc2.state().bookings[1].unitId, "u1");
});

test("tutte le camere occupate: l'anonimo riceve 409 no_availability e nulla viene scritto", async () => {
  const sc = scenario(baseData({ bookings: [seed({ unitId: "u1" }), seed({ id: "b-1", unitId: "u2", checkIn: day(31), checkOut: day(34) })] }));
  const r = await post(body());
  assert.equal(r.status, 409); assert.equal(r.json.error, "no_availability");
  assert.equal(sc.state().bookings.length, 2);
});

test("prenotazioni cancellate e camere fuori servizio non pesano sulla disponibilita'", async () => {
  const d = baseData({
    units: [{ id: "u0", roomTypeId: "rt-dbl", structureId: "st-1", outOfService: true }, { id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }],
    bookings: [seed({ unitId: "u1", status: "cancelled" })],
  });
  const sc = scenario(d);
  assert.equal((await post(body())).status, 200);
  assert.equal(sc.state().bookings[1].unitId, "u1");
});

test("pagamento gia' avvenuto ma nessuna camera libera (chiamata interna): si registra comunque, SENZA camera e con avviso, senza sovrapporla", async () => {
  const sc = scenario(baseData({ bookings: [seed({ unitId: "u1" }), seed({ id: "b-1", unitId: "u2" })] }), { internal: true });
  const r = await post(body({ deposit: 300 }));
  assert.equal(r.status, 200);
  const b = sc.state().bookings[2];
  assert.equal(b.unitId, null);
  assert.match(b.note, /nessuna camera libera in quelle date: da assegnare a mano/);
  assert.equal(b.paid, 300);
});

test("scrittura nel blob: la prenotazione e' una sola e il blocco 'rev' sale di uno", async () => {
  const sc = scenario();
  await post(body());
  assert.equal(sc.db.tables.app_state[0].rev, 2);
  assert.equal(sc.state().bookings.length, 1);
});

// ───────────────────────── camere condivise (gruppo di disponibilita') ─────────────────────────
const poolData = () => ({
  structures: [{ id: "st-1", name: "Casa A", email: "a@example.com" }, { id: "st-2", name: "Casa B" }],
  roomTypes: [{ id: "rt-a", structureId: "st-1", name: "Deluxe", beds: 2, basePrice: 100 }, { id: "rt-b", structureId: "st-2", name: "Deluxe", beds: 2, basePrice: 100 }],
  units: [{ id: "ua", roomTypeId: "rt-a", structureId: "st-1" }, { id: "ub", roomTypeId: "rt-b", structureId: "st-2" }],
  guests: [] as any[], bookings: [] as any[],
});
const POOL_ON = JSON.stringify({ enabled: true, structureIds: ["st-1", "st-2"], rooms: { deluxe: 1 } });

test("gruppo attivo: la camera fisica occupata dall'altra struttura rende la tipologia NON vendibile (409) anche se la sua camera risulta libera", async () => {
  const d = poolData();
  d.bookings.push({ id: "bb", structureId: "st-2", roomTypeId: "rt-b", unitId: "ub", status: "confirmed", checkIn: day(30), checkOut: day(33) });
  const sc = scenario(d, { blobExtra: { [POOL_KEY]: POOL_ON } });
  const r = await post(body({ rt: "rt-a", total: 300 }));
  assert.equal(r.status, 409); assert.equal(r.json.error, "no_availability");
  assert.equal(sc.state().bookings.length, 1);
});

test("gruppo attivo: date che non si sovrappongono all'altra struttura si vendono", async () => {
  const d = poolData();
  d.bookings.push({ id: "bb", structureId: "st-2", roomTypeId: "rt-b", unitId: "ub", status: "confirmed", checkIn: day(30), checkOut: day(33) });
  const sc = scenario(d, { blobExtra: { [POOL_KEY]: POOL_ON } });
  assert.equal((await post(body({ rt: "rt-a", ci: day(33), co: day(35), total: 200 }))).status, 200);
  assert.equal(sc.state().bookings.length, 2);
});

test("gruppo NON attivo (o disattivato): le strutture non si influenzano", async () => {
  const d = poolData();
  d.bookings.push({ id: "bb", structureId: "st-2", roomTypeId: "rt-b", unitId: "ub", status: "confirmed", checkIn: day(30), checkOut: day(33) });
  const sc = scenario(d, { blobExtra: { [POOL_KEY]: JSON.stringify({ enabled: false, structureIds: ["st-1", "st-2"], rooms: { deluxe: 1 } }) } });
  assert.equal((await post(body({ rt: "rt-a" }))).status, 200);
  assert.equal(sc.state().bookings.length, 2);
});

test("gruppo con 2 camere reali: ne basta una libera nella famiglia", async () => {
  const d = poolData();
  d.bookings.push({ id: "bb", structureId: "st-2", roomTypeId: "rt-b", unitId: "ub", status: "confirmed", checkIn: day(30), checkOut: day(33) });
  const sc = scenario(d, { blobExtra: { [POOL_KEY]: JSON.stringify({ enabled: true, structureIds: ["st-1", "st-2"], rooms: { deluxe: 2 } }) } });
  assert.equal((await post(body({ rt: "rt-a" }))).status, 200);
  assert.equal(sc.state().bookings.length, 2);
});

test("gruppo: una chiamata interna con pagamento gia' fatto viene registrata senza camera (non rifiutata)", async () => {
  const d = poolData();
  d.bookings.push({ id: "bb", structureId: "st-2", roomTypeId: "rt-b", unitId: "ub", status: "confirmed", checkIn: day(30), checkOut: day(33) });
  const sc = scenario(d, { blobExtra: { [POOL_KEY]: POOL_ON }, internal: true });
  assert.equal((await post(body({ rt: "rt-a", deposit: 300 }))).status, 200);
  assert.equal(sc.state().bookings[1].unitId, null);
});

// ───────────────────────── conflitti di scrittura ─────────────────────────
test("conflitto di revisione: rilegge, aggiunge la prenotazione allo stato aggiornato e non perde le modifiche altrui", async () => {
  const sc = scenario();
  let bumped = false;
  sc.db.afterSelect = (table, db) => {
    if (table === "app_state" && !bumped && db.log.filter((l) => l.op === "select" && l.table === "app_state").length === 1) {
      bumped = true;
      const row = db.tables.app_state[0] as any;
      const d = JSON.parse(row.data[DATA_KEY]); d.bookings.push(seed({ id: "altrui", unitId: "u2", checkIn: day(50), checkOut: day(52) })); row.data[DATA_KEY] = JSON.stringify(d); row.rev = 9;
    }
  };
  const r = await post(body());
  assert.equal(r.status, 200);
  const ids = sc.state().bookings.map((b: any) => b.id);
  assert.equal(ids.length, 2);
  assert.ok(ids.includes("altrui"));
});

test("conflitto di revisione con la stessa prenotazione gia' scritta da un'altra richiesta: 'already', nessun doppione", async () => {
  const sc = scenario();
  let bumped = false;
  sc.db.afterSelect = (table, db) => {
    if (table === "app_state" && !bumped) {
      bumped = true;
      const row = db.tables.app_state[0] as any;
      const d = JSON.parse(row.data[DATA_KEY]); d.bookings.push(seed({ id: "gemella", extId: "site:casa-ortigia:tok-1" })); row.data[DATA_KEY] = JSON.stringify(d); row.rev = 9;
    }
  };
  const r = await post(body());
  assert.equal(r.json.already, true);
  assert.equal(sc.state().bookings.length, 1);
});

test("conflitto di revisione: se nel frattempo la camera scelta e' stata presa, ripiega su un'altra libera (ricontrollo sui dati freschi)", async () => {
  const sc = scenario();
  let bumped = false;
  sc.db.afterSelect = (table, db) => {
    if (table === "app_state" && !bumped) {
      bumped = true;
      const row = db.tables.app_state[0] as any;
      const d = JSON.parse(row.data[DATA_KEY]); d.bookings.push(seed({ id: "presa-u1", unitId: "u1" })); row.data[DATA_KEY] = JSON.stringify(d); row.rev = 9;
    }
  };
  const r = await post(body());
  assert.equal(r.status, 200);
  const mine = sc.state().bookings.find((b: any) => b.extId === "site:casa-ortigia:tok-1");
  assert.equal(mine.unitId, "u2");
});

test("conflitto di revisione: se nel frattempo tutte le camere sono state prese, l'anonimo riceve 409 e non si scrive nulla", async () => {
  const sc = scenario();
  let bumped = false;
  sc.db.afterSelect = (table, db) => {
    if (table === "app_state" && !bumped) {
      bumped = true;
      const row = db.tables.app_state[0] as any;
      const d = JSON.parse(row.data[DATA_KEY]);
      d.bookings.push(seed({ id: "presa-u1", unitId: "u1" }), seed({ id: "presa-u2", unitId: "u2" }));
      row.data[DATA_KEY] = JSON.stringify(d); row.rev = 9;
    }
  };
  const r = await post(body());
  assert.equal(r.status, 409); assert.equal(r.json.error, "no_availability");
  assert.equal(sc.state().bookings.length, 2);
  assert.ok(!sc.state().bookings.some((b: any) => b.extId === "site:casa-ortigia:tok-1"));
});

test("importi ai centesimi: totale 123,50 e caparra 37,05 non vengono arrotondati all'euro", async () => {
  const sc = scenario(baseData(), { internal: true });
  const r = await post(body({ total: 123.5, deposit: 37.05, stripePaymentIntent: "pi_1" }));
  assert.equal(r.status, 200);
  const b = sc.state().bookings[0];
  assert.equal(b.total, 123.5);
  assert.equal(b.paid, 37.05);
});

test("errore di scrittura nel database = 500 write_error", async () => {
  const sc = scenario();
  sc.db.failUpdate = { app_state: "disco pieno" };
  const r = await post(body());
  assert.equal(r.status, 500); assert.equal(r.json.error, "write_error");
});

// ───────────────────────── email di conferma e disponibilita' verso i portali ─────────────────────────
test("email di conferma all'ospite (voucher) con i dati della struttura; disponibilita' inviata ai portali per struttura e tipologia prenotate", async () => {
  scenario();
  await post(body({ planName: "Flessibile", refundable: true, cancelDays: 3 }));
  assert.equal(calls("internalFetch").length, 1);
  const m = calls("internalFetch")[0];
  assert.equal(m.url, "https://test.xenora.local/api/email");
  assert.equal(m.body.kind, "voucher");
  assert.equal(m.body.booking.guestEmail, "giulia.rossi@example.com");
  assert.equal(m.body.booking.structureName, "Casa Ortigia");
  assert.equal(m.body.booking.nights, 3);
  assert.equal(m.body.booking.cancelPolicy, "Tariffa non rimborsabile."); // l'anonimo non puo' dichiarare "rimborsabile"
  assert.match(m.body.manageUrl, /\/gestisci\?site=casa-ortigia&b=/);
  assert.deepEqual(calls("poolPush")[0].touched, [{ structureId: "st-1", roomTypeId: "rt-dbl" }]);
});

test("senza email dell'ospite nessuna email, ma la disponibilita' parte comunque", async () => {
  scenario();
  await post(body({ guest: { firstName: "Anonimo" } }));
  assert.equal(calls("internalFetch").length, 0);
  assert.equal(calls("poolPush").length, 1);
});

test("nessuna email e nessun invio ai portali quando la prenotazione viene rifiutata", async () => {
  scenario(baseData({ bookings: [seed({ unitId: "u1" }), seed({ id: "b-1", unitId: "u2" })] }));
  await post(body());
  assert.equal(calls("internalFetch").length, 0);
  assert.equal(calls("poolPush").length, 0);
});

// ───────────────────────── punti deboli noti ─────────────────────────
test("tipologia inesistente nella struttura: dovrebbe essere rifiutata", async () => {
  const sc = scenario();
  const r = await post(body({ rt: "tipologia-inventata", total: 1 }));
  assert.notEqual(r.status, 200);
  assert.equal(sc.state().bookings.length, 0);
});

test("tipologia con tutte le camere fuori servizio: dal sito non dovrebbe essere prenotabile", async () => {
  const sc = scenario(baseData({ units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1", outOfService: true }] }));
  const r = await post(body());
  assert.equal(r.status, 409);
  assert.equal(sc.state().bookings.length, 0);
});

test("struttura condivisa (dati in org_state): la prenotazione dovrebbe finire nell'org_state e rispettare le sue camere", { todo: "DA VERIFICARE: la route legge e scrive sempre l'app_state personale del proprietario; per una struttura in società (org_state) non trova ne' camere ne' prenotazioni e la riga finisce nel blob personale (solo il blocco email cerca nell'org_state)" }, async () => {
  const org = baseData({ bookings: [seed({ unitId: "u1" }), seed({ id: "b-1", unitId: "u2" })] });
  const sc = scenario({ structures: [], roomTypes: [], units: [], guests: [], bookings: [] }, { orgData: org });
  const r = await post(body());
  assert.equal(r.status, 409); // le due camere dell'org sono occupate
  assert.equal(sc.state().bookings.length, 0);
});
