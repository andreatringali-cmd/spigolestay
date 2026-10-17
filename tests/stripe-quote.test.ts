import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Pagamento di un PREVENTIVO e saldo dal check-in (/api/stripe/quote, /api/stripe/quote/confirm).
// Importo, struttura, date e CONTO STRIPE si ricavano dal server (preventivo salvato o convalida contro i dati del proprietario):
// il browser dell'ospite non sceglie niente di cio' che finisce nei metadata o sul conto che incassa.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; session?: unknown; rateLimited?: boolean; chargesEnabled?: boolean; refundFail?: string; refundsDb?: any[] } };
G.__stubs = { calls: {} };
const quote = await import("../src/app/api/stripe/quote/route.ts");
const confirm = await import("../src/app/api/stripe/quote/confirm/route.ts");
const { ymdRome } = await import("../src/lib/dates-rome.ts");

const DATA_KEY = "spigolestay:data:v1";
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const calls = (k: string) => G.__stubs.calls[k] ?? [];

const baseData = (over: Record<string, unknown> = {}) => ({
  structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", currency: "€", stripeAccount: "acct_REAL" }],
  roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia", beds: 2, basePrice: 100 }],
  units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1", name: "Allegra" }, { id: "u2", roomTypeId: "rt-dbl", structureId: "st-1", name: "Sette" }],
  guests: [] as any[], bookings: [] as any[], ...over,
});
const QUOTE = { s: "Casa Ortigia", ci: day(30), co: day(33), ad: 2, ch: 0, rooms: [{ name: "Doppia", amount: 300 }], tot: 300, dep: 150, gn: "Giulia Rossi", ge: "giulia@example.com", sid: "st-1", rt: "rt-dbl", ref: "5/2026", uid: "owner-1", acct: "acct_ATTACKER", extras: [{ name: "Bici", price: 10, per: "day" }, { name: "Transfer", price: 40, per: "stay" }] };

function scenario(data: Record<string, unknown> = baseData(), opts: { quotes?: Record<string, unknown>; blobExtra?: Record<string, string> } = {}) {
  const { db, client } = makeFakeDb({
    profiles: [], platform_fees: [],
    public_sites: [{ slug: "casa-ortigia", user_id: "owner-1", structure_id: "st-1" }],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data), ...(opts.blobExtra ?? {}) } }],
    memberships: [], org_state: [],
  });
  const withRpc = { ...(client as object), rpc: async (fn: string, args: { p_code: string }) => (fn === "get_quote" ? { data: opts.quotes?.[args.p_code] ?? null, error: null } : { data: null, error: null }) };
  Object.assign(G.__stubs, { calls: {}, admin: withRpc, session: undefined, rateLimited: false, chargesEnabled: true, refundFail: undefined, refundsDb: [] });
  return { db, state: () => JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]) };
}
const post = async (handler: (r: Request) => Promise<unknown>, body: unknown) => {
  const res = (await handler(new Request("https://xenora.test/api/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify(body) }))) as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
};
const get = async (qs: string) => {
  const res = (await quote.GET(new Request("https://xenora.test/api/stripe/quote?" + qs, { headers: { "x-forwarded-for": "9.9.9.9" } }))) as unknown as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
};
const legacy = (over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  amount: 150, acct: "acct_ATTACKER", label: "Casa Ortigia", successUrl: "https://test.xenora.local/preventivo?c=x", cancelUrl: "https://test.xenora.local/preventivo?c=x",
  metadata: { sid: "st-1", rt: "rt-dbl", ci: day(30), co: day(33), tot: "300", dep: "150", uid: "owner-1", ge: "giulia@example.com", gn: "Giulia Rossi", ref: "5/2026", ...meta }, ...over,
});

// ───────────────────────── creazione della sessione: conto, importo, struttura dal server ─────────────────────────
test("quote: il conto Stripe e' quello della STRUTTURA (dal server), mai quello scritto dal client", async () => {
  scenario();
  const r = await post(quote.POST, legacy());
  assert.equal(r.status, 200); assert.equal(r.json.url, "https://stripe.test/pay");
  const p = calls("sessionCreate")[0];
  assert.equal(p.payment_intent_data.transfer_data.destination, "acct_REAL");
  assert.equal(p.payment_intent_data.on_behalf_of, "acct_REAL");
  assert.deepEqual(p.payment_method_types, ["card"]);
});

test("quote: client senza acct (vuoto) NON ripiega sul conto piattaforma: la sessione ha comunque il conto della struttura", async () => {
  scenario();
  const r = await post(quote.POST, legacy({ acct: "" }));
  assert.equal(r.status, 200);
  assert.equal(calls("sessionCreate")[0].payment_intent_data.transfer_data.destination, "acct_REAL");
});

test("quote: struttura SENZA conto Stripe collegato = 409 stripe_not_connected e nessuna sessione (prima finiva sulla piattaforma a nome Xenora)", async () => {
  scenario(baseData({ structures: [{ id: "st-1", name: "Casa Ortigia" }] }));
  const r = await post(quote.POST, legacy({ acct: "" }));
  assert.equal(r.status, 409); assert.equal(r.json.error, "stripe_not_connected");
  assert.equal(calls("sessionCreate").length, 0);
});

test("quote: conto collegato ma non abilitato a incassare = 409 stripe_not_active", async () => {
  scenario(); G.__stubs.chargesEnabled = false;
  const r = await post(quote.POST, legacy());
  assert.equal(r.status, 409); assert.equal(r.json.error, "stripe_not_active");
  assert.equal(calls("sessionCreate").length, 0);
});

test("quote: struttura che non appartiene al proprietario indicato (sid/uid inventati) = 400", async () => {
  scenario();
  for (const meta of [{ sid: "st-di-un-altro" }, { uid: "owner-2" }, { sid: "", uid: "" }]) {
    const r = await post(quote.POST, legacy({}, meta));
    assert.equal(r.status, 400, JSON.stringify(meta)); assert.ok(["invalid_structure", "invalid_quote"].includes(r.json.error), r.json.error);
  }
  assert.equal(calls("sessionCreate").length, 0);
});

test("quote: importo manomesso (0,50 € su un soggiorno da 300) o oltre il totale = 400 invalid_amount", async () => {
  scenario();
  for (const amount of [0.5, 0, -5, 5000]) {
    const r = await post(quote.POST, legacy({ amount }));
    assert.equal(r.status, 400, String(amount)); assert.equal(r.json.error, "invalid_amount");
  }
  assert.equal(calls("sessionCreate").length, 0);
});

test("quote: totale sotto la meta' del listino (soggiorno 'regalato') = 400 price_mismatch", async () => {
  scenario();
  const r = await post(quote.POST, legacy({ amount: 10 }, { tot: "20", dep: "10" }));
  assert.equal(r.status, 400); assert.equal(r.json.error, "price_mismatch");
});

test("quote: date impossibili (30 febbraio) o tipologia di un'altra struttura = 400", async () => {
  scenario();
  assert.equal((await post(quote.POST, legacy({}, { ci: "2027-02-30", co: "2027-03-02" }))).json.error, "bad_dates");
  assert.equal((await post(quote.POST, legacy({}, { rt: "rt-altrove" }))).json.error, "invalid_quote");
});

test("quote: kind e source non sono falsificabili e le chiavi fuori whitelist (fee_total, slug...) vengono scartate", async () => {
  scenario();
  const r = await post(quote.POST, legacy({ source: "ota" }, { kind: "book", source: "ota", fee_total: "99999", fee_base: "1", slug: "x" }));
  assert.equal(r.status, 200);
  const p = calls("sessionCreate")[0];
  assert.equal(p.metadata.kind, "quote"); assert.equal(p.metadata.source, "direct");
  assert.equal(p.payment_intent_data.metadata.kind, "quote");
  for (const k of ["fee_total", "fee_base", "slug"]) assert.equal(p.metadata[k], undefined, k);
  assert.equal(p.metadata.sid, "st-1"); assert.equal(p.metadata.uid, "owner-1");
});

test("quote: richiesta di ritorno su un altro sito = 400 invalid_return_url", async () => {
  scenario();
  const r = await post(quote.POST, legacy({ successUrl: "https://evil.example/x" }));
  assert.equal(r.status, 400); assert.equal(r.json.error, "invalid_return_url");
});

test("quote: troppe richieste dallo stesso IP = 429, senza leggere il database", async () => {
  scenario(); G.__stubs.rateLimited = true;
  const r = await post(quote.POST, legacy());
  assert.equal(r.status, 429); assert.equal(r.json.error, "troppe_richieste");
  assert.equal(calls("sessionCreate").length, 0);
});

// ───────────────────────── da codice breve (RPC get_quote) ─────────────────────────
test("codice: l'importo e' l'acconto del PREVENTIVO salvato (body.amount e acct del client ignorati), con i metadata decisi dal server", async () => {
  scenario(baseData(), { quotes: { abc123: QUOTE } });
  const r = await post(quote.POST, { code: "abc123", amount: 0.5, acct: "", successUrl: "https://test.xenora.local/preventivo?c=abc123", cancelUrl: "https://test.xenora.local/preventivo?c=abc123", locale: "de" });
  assert.equal(r.status, 200);
  const p = calls("sessionCreate")[0];
  assert.equal(p.line_items[0].price_data.unit_amount, 15000);
  assert.equal(p.payment_intent_data.transfer_data.destination, "acct_REAL");
  assert.equal(p.locale, "de");
  assert.match(p.line_items[0].price_data.product_data.name, /Casa Ortigia · \d{2}\.\d{2}\.\d{4} → \d{2}\.\d{2}\.\d{4}/);
  assert.match(p.line_items[0].price_data.product_data.description, /3 Nächte|3 nights|3 notti/);
  assert.equal(p.metadata.uid, "owner-1"); assert.equal(p.metadata.qc, "abc123"); assert.equal(p.metadata.tot, "300"); assert.equal(p.metadata.dep, "150"); assert.equal(p.metadata.acc, "300");
  assert.equal(p.metadata.rl, "rt-dbl~1~30000");
});

test("codice: gli extra scelti si prezzano sul server (a notte / a soggiorno) e si sommano all'acconto", async () => {
  scenario(baseData(), { quotes: { abc123: QUOTE } });
  await post(quote.POST, { code: "abc123", extras: [0, 1, 1, 7, "x"] }); // 0 = Bici 10 €/giorno x 3 notti; 1 = Transfer 40; doppioni e indici fuori elenco scartati
  const p = calls("sessionCreate")[0];
  assert.equal(p.line_items[0].price_data.unit_amount, 15000 + 3000 + 4000);
  assert.equal(p.metadata.ext, "Bici:30|Transfer:40");
});

test("codice: acconto 0 = nessun pagamento online (409 no_online_payment), NON si fa pagare l'intero", async () => {
  scenario(baseData(), { quotes: { abc123: { ...QUOTE, dep: 0 } } });
  const r = await post(quote.POST, { code: "abc123" });
  assert.equal(r.status, 409); assert.equal(r.json.error, "no_online_payment");
  assert.equal(calls("sessionCreate").length, 0);
});

test("codice sconosciuto = 404; preventivo con struttura/conto del client falsi ma uid reale: conto della struttura", async () => {
  scenario(baseData(), { quotes: { abc123: { ...QUOTE, acct: "acct_ATTACKER" } } });
  assert.equal((await post(quote.POST, { code: "nonesiste" })).status, 404);
  await post(quote.POST, { code: "abc123" });
  assert.equal(calls("sessionCreate")[0].payment_intent_data.transfer_data.destination, "acct_REAL");
});

test("codice: preventivo gia' confermato e pagato = 409 already_confirmed (niente secondo pagamento)", async () => {
  scenario(baseData({ bookings: [{ id: "b-0", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", status: "confirmed", checkIn: day(30), checkOut: day(33), extId: "quote:owner-1:abc123" }] }), { quotes: { abc123: QUOTE } });
  const r = await post(quote.POST, { code: "abc123" });
  assert.equal(r.status, 409); assert.equal(r.json.error, "already_confirmed");
});

test("GET: dice se il preventivo e' pagabile online (la pagina nasconde 'Paga' altrimenti)", async () => {
  scenario(baseData(), { quotes: { abc123: QUOTE, zero: { ...QUOTE, dep: 0 } } });
  assert.deepEqual(await get("code=abc123"), { status: 200, json: { payable: true, deposit: 150, total: 300 } });
  const z = await get("code=zero"); assert.equal(z.json.payable, false); assert.equal(z.json.reason, "no_online_payment");
  scenario(baseData({ structures: [{ id: "st-1", name: "Casa Ortigia" }] }), { quotes: { abc123: QUOTE } });
  const n = await get("code=abc123"); assert.equal(n.json.payable, false); assert.equal(n.json.reason, "stripe_not_connected");
});

// ───────────────────────── saldo dal check-in ─────────────────────────
const bk = (over: Record<string, unknown> = {}) => ({ id: "b-1", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: day(5), checkOut: day(8), total: 300, paid: 100, adults: 2, children: 0, ...over });
const dataWith = (b: Record<string, unknown>[], st: Record<string, unknown> = {}) => baseData({ guests: [{ id: "g1", firstName: "Giulia", lastName: "Rossi", email: "giulia@example.com" }], bookings: b, structures: [{ id: "st-1", name: "Casa Ortigia", stripeAccount: "acct_REAL", ...st }] });
const bal = (body: Record<string, unknown>) => ({ label: "Saldo", successUrl: "https://test.xenora.local/checkin?b=b-1", cancelUrl: "https://test.xenora.local/checkin?b=b-1", metadata: { bookingId: "b-1" }, ...body });

test("saldo check-in: conto della struttura della prenotazione (non quello del client) e importo mai oltre il residuo", async () => {
  scenario(dataWith([bk()]));
  const r = await post(quote.POST, bal({ amount: 9999, acct: "acct_ATTACKER" }));
  assert.equal(r.status, 200);
  const p = calls("sessionCreate")[0];
  assert.equal(p.line_items[0].price_data.unit_amount, 20000); // 300 - 100 gia' pagati
  assert.equal(p.payment_intent_data.transfer_data.destination, "acct_REAL");
  assert.equal(p.metadata.bookingId, "b-1");
});

test("saldo check-in: il client puo' chiedere MENO del residuo ma non meno del minimo Stripe", async () => {
  scenario(dataWith([bk()]));
  assert.equal((await post(quote.POST, bal({ amount: 50 }))).status, 200);
  assert.equal(calls("sessionCreate")[0].line_items[0].price_data.unit_amount, 5000);
  assert.equal((await post(quote.POST, bal({ amount: 0.2 }))).json.error, "amount_too_low");
});

test("saldo check-in: prenotazione annullata = 409 cancelled; gia' saldata = 409 already_paid; inesistente = 404; struttura senza Stripe = 409", async () => {
  scenario(dataWith([bk({ status: "cancelled" })]));
  assert.equal((await post(quote.POST, bal({}))).json.error, "cancelled");
  scenario(dataWith([bk({ paid: 300 })]));
  assert.equal((await post(quote.POST, bal({}))).json.error, "already_paid");
  scenario(dataWith([bk()]));
  assert.equal((await post(quote.POST, bal({ metadata: { bookingId: "non-esiste" } }))).status, 404);
  scenario(dataWith([bk()], { stripeAccount: "" }));
  assert.equal((await post(quote.POST, bal({}))).json.error, "stripe_not_connected");
  assert.equal(calls("sessionCreate").length, 0);
});

test("saldo check-in di GRUPPO: il residuo e' la somma delle camere attive del gruppo", async () => {
  scenario(dataWith([bk({ groupId: "g", paid: 100 }), bk({ id: "b-2", groupId: "g", paid: 50, total: 200 }), bk({ id: "b-3", groupId: "g", status: "cancelled", total: 999 })]));
  const r = await post(quote.POST, bal({ metadata: { bookingId: "b-1", group: "1" } }));
  assert.equal(r.status, 200);
  assert.equal(calls("sessionCreate")[0].line_items[0].price_data.unit_amount, 20000 + 15000);
  assert.equal(calls("sessionCreate")[0].metadata.group, "1");
});

// ───────────────────────── conferma dopo il pagamento ─────────────────────────
const META = { kind: "quote", uid: "owner-1", sid: "st-1", rt: "rt-dbl", ci: day(30), co: day(33), ad: "2", ch: "0", tot: "300", acc: "300", dep: "150", rl: "rt-dbl~1~30000", ref: "5/2026", qc: "abc123", gn: "Giulia Rossi", ge: "giulia@example.com", ext: "Bici:30", rf: "1", cd: "7" };
const paid = (metadata: Record<string, string>, amount_total = 15000, id = "cs_1") => ({ id, payment_status: "paid", amount_total, metadata, payment_intent: { id: "pi_" + id, transfer_data: { destination: "acct_REAL" } } });
const conf = (sessionId = "cs_1") => post(confirm.POST, { session_id: sessionId });

test("conferma: una sessione che non e' di un preventivo (kind book/chatpay o con bookingId) viene rifiutata", async () => {
  for (const meta of [{ ...META, kind: "book" }, { ...META, kind: "chatpay" }, { ...META, bookingId: "b-1" }, { ...META, kind: "" }]) {
    const sc = scenario(); G.__stubs.session = paid(meta);
    const r = await conf();
    assert.equal(r.status, 400, JSON.stringify(meta)); assert.equal(r.json.error, "not_a_quote");
    assert.equal(sc.state().bookings.length, 0);
  }
});

test("conferma: importo incassato diverso da quello deciso dal server (dep), o dep assente = rifiutata", async () => {
  let sc = scenario(); G.__stubs.session = paid(META, 50); // 0,50 € pagati contro dep=150 €
  let r = await conf();
  assert.equal(r.status, 400); assert.equal(r.json.error, "amount_mismatch"); assert.equal(sc.state().bookings.length, 0);
  const { dep: _d, ...senzaDep } = META;
  sc = scenario(); G.__stubs.session = paid(senzaDep as any);
  r = await conf();
  assert.equal(r.status, 400); assert.equal(r.json.error, "amount_mismatch"); assert.equal(sc.state().bookings.length, 0);
});

test("conferma: non pagata = 402", async () => {
  scenario(); G.__stubs.session = { ...paid(META), payment_status: "unpaid" };
  const r = await conf();
  assert.equal(r.status, 402); assert.equal(r.json.error, "not_paid");
});

test("conferma: prenotazione completa — incasso, data Roma, PaymentIntent, carta, politica, camera libera, ospite, totale senza doppioni", async () => {
  const sc = scenario(baseData({ structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", stripeAccount: "acct_REAL", cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2 }] }));
  // Il totale del preventivo (tot) include la tassa di soggiorno (2 persone x 3 notti x 2 € = 12 €) e 30 € di servizi (colazione): in prenotazione ci va SOLO il soggiorno.
  G.__stubs.session = paid({ ...META, tot: "342", acc: "300", xr: "30", ext: "Bici:30", dep: "150" });
  const r = await conf();
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  const b = sc.state().bookings[0];
  assert.equal(b.total, 300, "solo il soggiorno: la tassa la aggiunge l'app, non va contata due volte");
  assert.deepEqual(b.extras.map((e: any) => [e.name.slice(0, 6), e.price]), [["Bici", 30], ["Serviz", 30]]);
  assert.equal(b.paid, 150); assert.equal(b.paidOnline, 150); assert.equal(b.paidAt, ymdRome(Date.now()));
  assert.equal(b.stripePaymentIntent, "pi_cs_1"); assert.equal(b.stripeSessionId, "cs_1"); assert.equal(b.stripeAccountId, "acct_REAL");
  assert.equal(b.paymentMethod, "carta"); assert.equal(b.depositPaid, true);
  assert.equal(b.refundable, true); assert.equal(b.cancelDays, 7);
  assert.equal(b.source, "manuale"); assert.match(b.code, /^XEN-\d{4}-0001$/);
  assert.equal(b.channel, "direct"); assert.equal(b.status, "confirmed"); assert.equal(b.unitId, "u1");
  assert.equal(b.extId, "quote:owner-1:abc123"); assert.deepEqual(b.paidSessions, ["cs_1"]);
  assert.equal(b.bookedOn, ymdRome(Date.now()));
  const g = sc.state().guests[0]; assert.equal(g.email, "giulia@example.com"); assert.equal(b.guestId, g.id);
  // avviso al titolare + disponibilita' ai portali
  const n = calls("internalFetch").find((c) => c.body.kind === "notify");
  assert.equal(n.body.to, "info@casa.example"); assert.equal(n.body.event, "newBooking"); assert.equal(n.body.channelLabel, "Diretto");
  assert.match(n.body.ctaUrl, /\/prenotazioni\?b=/); assert.equal(n.body.brand.name, "Casa Ortigia");
  assert.equal(calls("poolPush").length, 1);
});

test("conferma: idempotente — lo stesso ritorno pagina due volte (o dopo il webhook) = una sola prenotazione", async () => {
  const sc = scenario(); G.__stubs.session = paid(META);
  assert.equal((await conf()).json.already, undefined);
  const r2 = await conf();
  assert.equal(r2.status, 200); assert.equal(r2.json.already, true);
  assert.equal(sc.state().bookings.length, 1);
  assert.equal(calls("refund").length, 0);
});

test("conferma: secondo pagamento dello STESSO preventivo (altra sessione) = nessuna seconda prenotazione, la seconda sessione viene rimborsata", async () => {
  const sc = scenario(); G.__stubs.session = paid(META, 15000, "cs_1");
  await conf("cs_1");
  G.__stubs.session = paid(META, 15000, "cs_2");
  const r = await conf("cs_2");
  assert.equal(r.status, 200); assert.equal(r.json.duplicateRefunded, true);
  assert.equal(sc.state().bookings.length, 1);
  const rf = calls("refund");
  assert.equal(rf.length, 1); assert.equal(rf[0].params.payment_intent, "pi_cs_2"); assert.equal(rf[0].params.amount, 15000); assert.equal(rf[0].params.reverse_transfer, true);
  // ritentare non rimborsa due volte
  await conf("cs_2");
  assert.equal(calls("refund").length, 1);
});

test("conferma: nessuna camera libera = prenotazione SENZA camera e con avviso, mai sopra un'altra prenotazione", async () => {
  const occ = (id: string, unitId: string) => ({ id, structureId: "st-1", roomTypeId: "rt-dbl", unitId, status: "confirmed", checkIn: day(29), checkOut: day(34), channel: "direct" });
  const sc = scenario(baseData({ bookings: [occ("o1", "u1"), occ("o2", "u2")] })); G.__stubs.session = paid(META);
  const r = await conf();
  assert.equal(r.status, 200);
  const b = sc.state().bookings.find((x: any) => x.extId === "quote:owner-1:abc123");
  assert.equal(b.unitId, null); assert.match(b.note, /nessuna camera libera in quelle date: da assegnare a mano/);
  assert.equal(b.paid, 150);
});

test("conferma: camere multiple — una prenotazione per camera nello stesso gruppo, incasso ripartito e quota di PaymentIntent per camera", async () => {
  const sc = scenario(); G.__stubs.session = paid({ ...META, tot: "600", acc: "600", dep: "300", rl: "rt-dbl~2~60000", ext: "", ad: "4" }, 30000);
  const r = await conf();
  assert.equal(r.status, 200);
  const bs = sc.state().bookings;
  assert.equal(bs.length, 2);
  assert.equal(bs[0].groupId, bs[1].groupId);
  assert.deepEqual(bs.map((b: any) => b.total), [300, 300]);
  assert.equal(bs.reduce((a: number, b: any) => a + b.paid, 0), 300);
  assert.notEqual(bs[0].unitId, bs[1].unitId);
  assert.deepEqual(bs.map((b: any) => b.adults), [2, 2]);
  for (const b of bs) assert.deepEqual(b.stripeExtraPayments, [{ pi: "pi_cs_1", amount: b.paid }]);
  assert.equal(bs[0].extId, "quote:owner-1:abc123"); assert.equal(bs[1].extId, "quote:owner-1:abc123#2");
});

test("conferma: segna il preventivo come confermato nella copia sul server", async () => {
  const sc = scenario(baseData(), { blobExtra: { "spigolestay:preventivi": JSON.stringify([{ number: 5, status: "inviato" }]) } });
  G.__stubs.session = paid(META);
  await conf();
  assert.equal(JSON.parse((sc.db.tables.app_state[0].data as any)["spigolestay:preventivi"])[0].status, "confermato");
});

test("conferma: avviso al titolare spento se 'Nuove prenotazioni' e' disattivato nelle Impostazioni", async () => {
  scenario(baseData(), { blobExtra: { "spigolestay:notifs": JSON.stringify({ newBooking: false }) } });
  G.__stubs.session = paid(META);
  await conf();
  assert.equal(calls("internalFetch").filter((c) => c.body.kind === "notify").length, 0);
});

test("conferma: conflitto di revisione = riprova sui dati freschi e non perde le modifiche del proprietario", async () => {
  const sc = scenario(); G.__stubs.session = paid(META);
  let bumped = false;
  sc.db.afterSelect = (table, db) => {
    if (table === "app_state" && !bumped) {
      bumped = true;
      const row = db.tables.app_state[0] as any;
      const d = JSON.parse(row.data[DATA_KEY]); d.bookings.push({ id: "altrui", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", status: "confirmed", checkIn: day(30), checkOut: day(33), channel: "direct" }); row.data[DATA_KEY] = JSON.stringify(d); row.rev = 9;
    }
  };
  const r = await conf();
  assert.equal(r.status, 200);
  const bs = sc.state().bookings;
  assert.equal(bs.length, 2); assert.ok(bs.some((b: any) => b.id === "altrui"));
  assert.equal(bs.find((b: any) => b.extId === "quote:owner-1:abc123").unitId, "u2", "la camera presa nel frattempo non viene riusata");
});

test("codice: preventivo con acconto irrisorio (0,50 € su 300 €, scritto da chiunque nella tabella quotes) = 400 invalid_amount", async () => {
  scenario(baseData(), { quotes: { poco: { ...QUOTE, dep: 0.5 }, ok10: { ...QUOTE, dep: 30 } } });
  const r = await post(quote.POST, { code: "poco" });
  assert.equal(r.status, 400); assert.equal(r.json.error, "invalid_amount");
  assert.equal(calls("sessionCreate").length, 0);
  assert.equal((await post(quote.POST, { code: "ok10" })).status, 200, "10% del listino (il minimo) passa");
});
