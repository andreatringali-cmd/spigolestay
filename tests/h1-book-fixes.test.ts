import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Correzioni gruppo H1: prenotazione dal sito (extra, promo, tariffe derivate, email non valida, lingua, piani dell'organizzazione), importo addebitato,
// esiti dopo il pagamento (conferma pagina / webhook), gestione prenotazione dell'ospite (modifica, annullamento ripetuto, finestra gratuita) e preventivi.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_finto";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; internal?: boolean; rateLimited?: boolean; session?: unknown; event?: unknown; chargesEnabled?: boolean; refundFail?: string; refundsDb?: any[]; internalResponse?: (url: string) => unknown } };
G.__stubs = { calls: {} };
const pbRoute = await import("../src/app/api/public-booking/route.ts");
const bookRoute = await import("../src/app/api/stripe/book/route.ts");
const quoteRoute = await import("../src/app/api/stripe/quote/route.ts");
const webhook = await import("../src/app/api/stripe/webhook/route.ts");
const infoRoute = await import("../src/app/api/manage-booking/route.ts");
const cancelRoute = await import("../src/app/api/manage-booking/cancel/route.ts");
const modifyRoute = await import("../src/app/api/manage-booking/modify/route.ts");
const { refundEligible, unrefundedOf } = await import("../src/lib/manage-booking.ts");
const { publicBookingBodyFromSession, bookingWriteFailure, bookingSummaryFrom } = await import("../src/lib/book-session.ts");
const { rootRoomTypeId, resolveBookPromo, floorWithPromo, encodeOrderExtras, decodeOrderExtras } = await import("../src/lib/book-order.ts");

const DATA_KEY = "spigolestay:data:v1";
const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const calls = (k: string) => G.__stubs.calls[k] ?? [];

const baseData = (over: Record<string, unknown> = {}, st: Record<string, unknown> = {}) => ({
  structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", currency: "€", stripeAccount: "acct_REAL", extras: [{ id: "col", name: "Colazione", price: 10, per: "person" }], ...st }],
  roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia", beds: 2, basePrice: 100 }, { id: "rt-der", structureId: "st-1", name: "Doppia vista mare", beds: 2, basePrice: 100, deriveFrom: "rt-dbl" }],
  units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }],
  guests: [] as any[], bookings: [] as any[], ...over,
});
function scenario(data: Record<string, unknown> = baseData(), opts: { blobExtra?: Record<string, string>; internal?: boolean; org?: { data: Record<string, unknown>; blobExtra?: Record<string, string> }; profiles?: any[] } = {}) {
  const { db, client } = makeFakeDb({
    profiles: opts.profiles ?? [], platform_fees: [],
    public_sites: [{ slug: "casa-ortigia", user_id: "owner-1", structure_id: "st-1" }],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data), ...(opts.blobExtra ?? {}) } }],
    memberships: opts.org ? [{ user_id: "owner-1", org_id: "org-1" }] : [],
    org_state: opts.org ? [{ org_id: "org-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(opts.org.data), ...(opts.org.blobExtra ?? {}) } }] : [],
  });
  const withRpc = { ...(client as object), rpc: async () => ({ data: null, error: null }) };
  Object.assign(G.__stubs, { calls: {}, admin: withRpc, internal: !!opts.internal, rateLimited: false, session: undefined, event: undefined, chargesEnabled: true, refundFail: undefined, refundsDb: [], internalResponse: undefined });
  return { db, state: () => JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]) };
}
const post = async (handler: (r: Request) => Promise<unknown>, b: unknown, url = "https://xenora.test/api/x") => {
  const res = (await handler(new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify(b) }))) as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
};
const pb = (b: unknown) => post(pbRoute.POST, b);
const pbBody = (o: Record<string, unknown> = {}) => ({
  slug: "casa-ortigia", rt: "rt-dbl", ci: day(30), co: day(33), adults: 2, children: 0, total: 300, token: "tok-1",
  guest: { firstName: "Giulia", lastName: "Rossi", email: "giulia.rossi@example.com", phone: "+393331112233", country: "IT" }, ...o,
});
const bookBody = (o: Record<string, unknown> = {}) => ({
  slug: "casa-ortigia", s: "st-1", rt: "rt-dbl", ci: day(30), co: day(33), adults: 2, children: 0, total: 300, deposit: 0.5, planName: "Non rimborsabile", token: "tok-1",
  guest: { firstName: "Anna Maria", lastName: "Rossi", email: "giulia@example.com", phone: "+393331112233", country: "IT" }, ...o,
});

// ───────────────────────── #4 email non valida dopo l'incasso ─────────────────────────
test("public-booking: chiamata INTERNA (gia' pagato) con email non valida = prenotazione salvata senza email, mai 400; l'anonimo resta 400 bad_email", async () => {
  let sc = scenario(baseData(), { internal: true });
  const guest = { firstName: "G", lastName: "R", email: "a@b", phone: "1" };
  const r = await pb(pbBody({ deposit: 100, stripePaymentIntent: "pi_x", guest }));
  assert.equal(r.status, 200);
  const b = sc.state().bookings[0];
  assert.equal(b.paid, 100); assert.match(b.note, /email indicata dall'ospite non valida: a@b/);
  assert.equal(sc.state().guests[0].email, undefined);
  assert.equal(calls("internalFetch").filter((c) => c.body.kind === "voucher").length, 0, "senza email nessun voucher");
  sc = scenario(baseData());
  const r2 = await pb(pbBody({ guest }));
  assert.equal(r2.status, 400); assert.equal(r2.json.error, "bad_email");
});

// ───────────────────────── #2 extra e promo ─────────────────────────
test("public-booking: gli extra scelti si validano sul catalogo del proprietario (prezzo dal server) e finiscono su booking.extras e nel voucher", async () => {
  const sc = scenario(baseData());
  const r = await pb(pbBody({ extras: [{ id: "col", qty: 2, price: 0.01, name: "hack" }, { id: "inesistente", qty: 1, price: 999 }] }));
  assert.equal(r.status, 200);
  const b = sc.state().bookings[0];
  assert.deepEqual(b.extras, [{ name: "Colazione ×2", price: 40, extraId: "col", qty: 2 }], "2 adulti × 10 € × 2 = 40 €");
  const v = calls("internalFetch")[0].body.booking;
  assert.equal(v.grandTotal, 340); assert.deepEqual(v.extras, b.extras);
});

test("public-booking: il codice promo si valida sulle promo del proprietario; abbassa la soglia del 50% solo se valido", async () => {
  const promos = [{ id: "p1", name: "Meta", code: "META50", discountPct: 50 }, { id: "p2", name: "Scaduta", code: "OLD", discountPct: 50, validUntil: day(-5) }, { id: "p3", name: "Altra struttura", code: "ALTRA", discountPct: 50, structureId: "st-9" }];
  const blobExtra = { "spigolestay:promos": JSON.stringify(promos) };
  // listino 300, soglia 150: 100 e' il soggiorno gia' scontato del 50% (ha senso solo con la promo valida)
  let sc = scenario(baseData(), { blobExtra });
  let r = await pb(pbBody({ total: 100, promoCode: "meta50" }));
  assert.equal(r.status, 200);
  assert.equal(sc.state().bookings[0].promoCode, "META50"); assert.equal(sc.state().bookings[0].promoPct, 50);
  for (const promoCode of [undefined, "OLD", "ALTRA", "INVENTATO"]) {
    sc = scenario(baseData(), { blobExtra });
    r = await pb(pbBody({ total: 100, promoCode }));
    assert.equal(r.status, 400, String(promoCode)); assert.equal(r.json.error, "price_mismatch");
  }
});

test("book-order: il codice promo non riduce mai la soglia oltre il 50% e rootRoomTypeId risale alla madre (con cicli)", () => {
  assert.equal(floorWithPromo(150, 0), 150); assert.equal(floorWithPromo(150, 50), 75); assert.equal(floorWithPromo(150, 100), 75, "una promo del 100% non regala il soggiorno");
  const rts = [{ id: "a" }, { id: "b", deriveFrom: "a" }, { id: "c", deriveFrom: "b" }, { id: "x", deriveFrom: "y" }, { id: "y", deriveFrom: "x" }, { id: "orfana", deriveFrom: "non-esiste" }];
  assert.equal(rootRoomTypeId(rts, "c"), "a"); assert.equal(rootRoomTypeId(rts, "a"), "a"); assert.equal(rootRoomTypeId(rts, "orfana"), "orfana");
  assert.ok(["x", "y"].includes(rootRoomTypeId(rts, "x")), "un ciclo non manda in loop");
  assert.equal(resolveBookPromo([{ code: "A", discountPct: 10, validFrom: "2030-01-01" }], "a", { structureId: "s", checkIn: "2029-12-31", today: "2029-01-01" }), null);
  assert.deepEqual(resolveBookPromo([{ code: "A", discountPct: 10 }], " a ", { structureId: "s", checkIn: "2029-12-31", today: "2029-01-01" }), { code: "A", pct: 10 });
  assert.deepEqual(decodeOrderExtras(encodeOrderExtras([{ extraId: "col", qty: 2 }, { extraId: "bici", qty: 1 }])), [{ id: "col", qty: 2 }, { id: "bici", qty: 1 }]);
  assert.deepEqual(decodeOrderExtras("col~2|rotto|x~0|y~z"), [{ id: "col", qty: 2 }]);
});

// ───────────────────────── #6 tariffe derivate ─────────────────────────
test("public-booking: una tariffa derivata usa le camere della tipologia madre (prima libera) e resta prenotata come derivata", async () => {
  const sc = scenario(baseData());
  const r = await pb(pbBody({ rt: "rt-der" }));
  assert.equal(r.status, 200);
  const b = sc.state().bookings[0];
  assert.equal(b.roomTypeId, "rt-der"); assert.equal(b.unitId, "u1");
  // camera della madre occupata: la derivata non e' disponibile
  scenario(baseData({ bookings: [{ id: "b0", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", status: "confirmed", checkIn: day(30), checkOut: day(33), channel: "direct" }] }));
  const r2 = await pb(pbBody({ rt: "rt-der" }));
  assert.equal(r2.status, 409); assert.equal(r2.json.error, "no_availability");
});

// ───────────────────────── #9 piani dell'organizzazione, #13 lingua ─────────────────────────
test("public-booking: i piani tariffari che stanno nell'organizzazione valgono per la politica del voucher (non 'non rimborsabile')", async () => {
  const plans = [{ id: "sp", name: "Speciale", adjPct: 0, refundable: true, cancelDays: 5, deposit: "none", minStay: 1 }];
  const sc = scenario(baseData(), { org: { data: { structures: [], roomTypes: [], units: [], bookings: [], guests: [] }, blobExtra: { "spigolestay:rateplans": JSON.stringify(plans) } } });
  const r = await pb(pbBody({ planName: "Speciale" }));
  assert.equal(r.status, 200);
  const b = sc.state().bookings[0];
  assert.equal(b.refundable, true); assert.equal(b.cancelDays, 5);
  assert.equal(calls("internalFetch")[0].body.booking.cancelPolicy, "Cancellazione gratuita fino a 5 giorni prima dell'arrivo.");
});

test("public-booking: la lingua della pagina (lang o guest.language) finisce nel voucher e nella scheda ospite; lingua sconosciuta ignorata", async () => {
  let sc = scenario(baseData());
  await pb(pbBody({ lang: "de" }));
  assert.equal(calls("internalFetch")[0].body.booking.guestLanguage, "de"); assert.equal(sc.state().guests[0].language, "de");
  sc = scenario(baseData());
  await pb(pbBody({ guest: { firstName: "G", lastName: "R", email: "g@example.com", language: "fr" } }));
  assert.equal(calls("internalFetch")[0].body.booking.guestLanguage, "fr");
  sc = scenario(baseData());
  await pb(pbBody({ lang: "xx" }));
  assert.equal(calls("internalFetch")[0].body.booking.guestLanguage, undefined); assert.equal(sc.state().guests[0].language, undefined);
});

// ───────────────────────── #2 importo addebitato = quello mostrato ─────────────────────────
test("stripe/book: piano prepagato = soggiorno + extra (validati dal server), SENZA tassa di soggiorno; il client non puo' abbassare ne' gonfiare l'importo", async () => {
  scenario(baseData({}, { cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2 }));
  const r = await post(bookRoute.POST, bookBody({ extras: [{ id: "col", qty: 2 }, { id: "boh", qty: 5 }], deposit: 0.5, cityTax: 12, grandTotal: 352 }));
  assert.equal(r.status, 200); assert.equal(r.json.payment, true);
  const p = calls("sessionCreate")[0];
  assert.equal(p.line_items[0].price_data.unit_amount, 34000, "300 soggiorno + 40 extra; la tassa (12) non si addebita online");
  assert.equal(p.metadata.dep, "340"); assert.equal(p.metadata.tot, "300"); assert.equal(p.metadata.ex, "col~2");
  assert.equal(p.metadata.gf, "Anna Maria"); assert.equal(p.metadata.gl, "Rossi");
  // un acconto proposto dal client oltre il totale pagabile viene limitato a soggiorno + extra
  scenario(baseData());
  await post(bookRoute.POST, bookBody({ extras: [{ id: "col", qty: 1 }], deposit: 9999 }));
  assert.equal(calls("sessionCreate")[0].line_items[0].price_data.unit_amount, 32000);
});

test("stripe/book: piano con caparra: la % si applica a soggiorno + extra (il client puo' pagare di piu', non di meno)", async () => {
  const plans = [{ id: "p30", name: "Standard", adjPct: 0, refundable: true, cancelDays: 7, deposit: "deposit", depositPct: 30, minStay: 1 }];
  scenario(baseData(), { blobExtra: { "spigolestay:rateplans": JSON.stringify(plans) } });
  await post(bookRoute.POST, bookBody({ planName: "Standard", extras: [{ id: "col", qty: 2 }], deposit: 1 }));
  const p = calls("sessionCreate")[0];
  assert.equal(p.line_items[0].price_data.unit_amount, 10200, "30% di (300 + 40) = 102 €");
  assert.match(p.line_items[0].price_data.product_data.name, /\(caparra\)/);
});

test("stripe/book: codice promo valido abbassa la soglia (fino al 50%), uno inventato no; il codice valido viaggia nei metadata", async () => {
  const blobExtra = { "spigolestay:promos": JSON.stringify([{ id: "p1", name: "Meta", code: "META50", discountPct: 50 }]) };
  scenario(baseData(), { blobExtra });
  let r = await post(bookRoute.POST, bookBody({ total: 100, promoCode: "META50" }));
  assert.equal(r.status, 200); assert.equal(calls("sessionCreate")[0].metadata.pc, "META50");
  assert.equal(calls("sessionCreate")[0].line_items[0].price_data.unit_amount, 10000);
  scenario(baseData(), { blobExtra });
  r = await post(bookRoute.POST, bookBody({ total: 100, promoCode: "FALSO" }));
  assert.equal(r.status, 400); assert.equal(r.json.error, "price_mismatch");
  scenario(baseData(), { blobExtra });
  r = await post(bookRoute.POST, bookBody({ total: 70, promoCode: "META50" }));
  assert.equal(r.json.error, "price_mismatch", "oltre il 50% di sconto non si scende");
});

test("stripe/book: tariffa derivata — la disponibilita' si verifica sulle camere della madre", async () => {
  scenario(baseData());
  let r = await post(bookRoute.POST, bookBody({ rt: "rt-der" }));
  assert.equal(r.status, 200); assert.equal(r.json.payment, true);
  scenario(baseData({ bookings: [{ id: "b0", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", status: "confirmed", checkIn: day(31), checkOut: day(32), channel: "direct" }] }));
  r = await post(bookRoute.POST, bookBody({ rt: "rt-der" }));
  assert.equal(r.status, 409); assert.equal(r.json.error, "no_availability");
});

// ───────────────────────── #14 nome/cognome, riepilogo, esiti ─────────────────────────
test("book-session: nome e cognome arrivano separati (gf/gl); le sessioni vecchie con solo 'gn' dividono al primo spazio; extra e promo passano a public-booking", () => {
  const base = { id: "cs_1", amount_total: 34000 };
  const nuova = publicBookingBodyFromSession({ ...base, metadata: { rt: "rt-dbl", ci: "2030-01-01", co: "2030-01-03", gn: "Anna Maria Rossi", gf: "Anna Maria", gl: "Rossi", ex: "col~2", pc: "META50", lg: "de" } }, { slug: "s", paymentIntent: "pi", accountId: "a" }) as any;
  assert.deepEqual([nuova.guest.firstName, nuova.guest.lastName], ["Anna Maria", "Rossi"]);
  assert.deepEqual(nuova.extras, [{ extraId: "col", qty: 2 }]); assert.equal(nuova.promoCode, "META50"); assert.equal(nuova.lang, "de");
  const vecchia = publicBookingBodyFromSession({ ...base, metadata: { rt: "rt-dbl", ci: "2030-01-01", co: "2030-01-03", gn: "Anna Maria Rossi" } }, { slug: "s", paymentIntent: "pi", accountId: "a" }) as any;
  assert.deepEqual([vecchia.guest.firstName, vecchia.guest.lastName], ["Anna", "Maria Rossi"]);
  assert.equal(vecchia.extras, undefined);
  const solo = publicBookingBodyFromSession({ ...base, metadata: { rt: "rt-dbl", ci: "2030-01-01", co: "2030-01-03", gn: "Cher", gf: "Cher", gl: "" } }, { slug: "s", paymentIntent: "pi", accountId: "a" }) as any;
  assert.deepEqual([solo.guest.firstName, solo.guest.lastName], ["Cher", ""]);
});

test("book-session: riepilogo dai metadata (prenotazione non ancora rileggibile) = soggiorno + extra + tassa, come il checkout", () => {
  const st = { id: "st-1", name: "Casa", cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2, cityTaxMaxNights: 3, extras: [{ id: "col", name: "Colazione", price: 10, per: "person" }] };
  const s = bookingSummaryFrom({ session: { id: "cs", amount_total: 34000, metadata: { ci: "2030-01-01", co: "2030-01-04", ad: "2", ch: "0", tot: "300", ex: "col~2", gn: "A B" } }, structure: st });
  assert.equal(s.cityTax, 12); assert.equal(s.grandTotal, 352); assert.equal(s.paid, 340);
});

test("bookingWriteFailure: transitorio (5xx, 409, 429, rete) = ritenta con status 409/502; permanente (404, 400) = 422 senza ritentare", () => {
  assert.deepEqual(bookingWriteFailure(409, { error: "write_conflict" }), { permanent: false, httpStatus: 409, error: "write_conflict" });
  assert.deepEqual(bookingWriteFailure(500, { error: "read_error" }), { permanent: false, httpStatus: 502, error: "read_error" });
  assert.deepEqual(bookingWriteFailure(500, {}), { permanent: false, httpStatus: 502, error: "booking_write_failed" });
  assert.equal(bookingWriteFailure(429, {}).permanent, false);
  assert.deepEqual(bookingWriteFailure(404, { error: "site_not_found" }), { permanent: true, httpStatus: 422, error: "site_not_found" });
  assert.deepEqual(bookingWriteFailure(400, { error: "bad_request" }), { permanent: true, httpStatus: 422, error: "bad_request" });
  assert.equal(bookingWriteFailure(400, null).error, "http_400");
});

// ───────────────────────── #4/#5 webhook e conferma ─────────────────────────
const bookSession = (meta: Record<string, string> = {}) => ({
  id: "cs_9", mode: "payment", payment_status: "paid", amount_total: 9000, payment_intent: { id: "pi_9", transfer_data: { destination: "acct_REAL" } },
  metadata: { kind: "book", slug: "casa-ortigia", s: "st-1", rt: "rt-dbl", ci: day(30), co: day(33), ad: "2", ch: "0", tot: "300", dep: "90", gn: "Giulia Rossi", ge: "g@example.com", token: "tok-1", ...meta },
});
const hook = async (event: unknown) => {
  G.__stubs.event = event;
  const res = (await webhook.POST(new Request("https://xenora.test/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" }))) as unknown as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
};
const failPb = (status: number, error: string) => (url: string) => (url.endsWith("/api/public-booking") ? { ok: false, status, json: async () => ({ error }) } : undefined);

test("webhook: pagato ma errore PERMANENTE di public-booking (404 site_not_found) = 200 (niente retry per giorni) e avviso a titolare e amministratori", async () => {
  scenario();
  G.__stubs.internalResponse = failPb(404, "site_not_found");
  const r = await hook({ type: "checkout.session.completed", data: { object: bookSession() } });
  assert.equal(r.status, 200);
  const mails = calls("internalFetch").filter((c) => c.url.endsWith("/api/email"));
  const to = mails.map((m) => m.body.to);
  assert.ok(to.includes("info@casa.example"), "titolare avvisato");
  assert.ok(to.includes("spigolehouse@gmail.com"), "amministratori avvisati");
  assert.match(mails[0].body.text, /NON è stata registrata/); assert.match(mails[0].body.text, /cs_9/); assert.match(mails[0].body.text, /site_not_found/);
  assert.equal(calls("refund").length, 0, "nessun rimborso automatico: decide una persona");
});

test("webhook: errore TRANSITORIO (500, 409 write_conflict) = 500 cosi' Stripe riprova, senza avvisi", async () => {
  for (const [status, error] of [[500, "read_error"], [409, "write_conflict"]] as const) {
    scenario();
    G.__stubs.internalResponse = failPb(status, error);
    const r = await hook({ type: "checkout.session.completed", data: { object: bookSession() } });
    assert.equal(r.status, 500, error);
    assert.equal(calls("internalFetch").filter((c) => c.url.endsWith("/api/email")).length, 0);
  }
});

// ───────────────────────── #7 modifica / #12 finestra / #11 annullamento / #16 unrefunded ─────────────────────────
function mbScenario(booking: Record<string, unknown>) {
  const data = {
    structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", currency: "€" }],
    roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia" }], units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }],
    guests: [{ id: "g1", firstName: "Giulia", lastName: "Rossi", email: "giulia@example.com" }],
    bookings: [{ id: "b-1", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: day(30), checkOut: day(33), total: 300, paid: 100, refundable: true, cancelDays: 7, stripePaymentIntent: "pi_1", ...booking }],
  };
  return scenario(data as never);
}
const mb = (route: (r: Request) => Promise<unknown>, payload: unknown) => post(route, payload);

test("modifica: allungare un soggiorno IN CORSO indicando solo la nuova partenza non e' 'arrivo nel passato'; un arrivo passato indicato dall'ospite si', date incoerenti no", async () => {
  mbScenario({ checkIn: day(-2), checkOut: day(3) });
  let r = await mb(modifyRoute.POST, { slug: "casa-ortigia", b: "b-1", co: day(5) });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  mbScenario({ checkIn: day(-2), checkOut: day(3) });
  r = await mb(modifyRoute.POST, { slug: "casa-ortigia", b: "b-1", ci: day(-1), co: day(5) });
  assert.equal(r.status, 400); assert.equal(r.json.error, "bad_dates");
  mbScenario({ checkIn: day(-2), checkOut: day(3) });
  r = await mb(modifyRoute.POST, { slug: "casa-ortigia", b: "b-1", co: day(-3) });
  assert.equal(r.status, 400, "partenza prima dell'arrivo");
});

test("finestra gratuita con 0 giorni di preavviso: l'ultimo giorno utile e' la vigilia (dal giorno dell'arrivo l'ospite non puo' annullare da solo)", () => {
  assert.deepEqual(refundEligible({ refundable: true, cancelDays: 0, checkIn: "2026-07-10" }, "2026-07-09T10:00:00Z"), { free: true, freeUntil: "2026-07-09" });
  assert.deepEqual(refundEligible({ refundable: true, cancelDays: 0, checkIn: "2026-07-10" }, "2026-07-10T08:00:00Z"), { free: false, freeUntil: "2026-07-09" });
  assert.equal(refundEligible({ refundable: true, cancelDays: 2, checkIn: "2026-07-10" }, "2026-07-08T10:00:00Z").freeUntil, "2026-07-08");
});

test("annullamento ripetuto su prenotazione gia' annullata dal webhook con saldo non rimborsato: il retry rimborsa il saldo (una volta), non il principale", async () => {
  const sc = mbScenario({ status: "cancelled", cancelledBy: "host", cancelledAt: new Date().toISOString(), paid: 300, refundedAmount: 100, stripePaymentIntent: "pi_1", stripeRefundedCents: { pi_1: 10000 }, stripeExtraPayments: [{ pi: "pi_2", amount: 200 }] });
  const r = await mb(cancelRoute.POST, { slug: "casa-ortigia", b: "b-1" });
  assert.equal(r.status, 200); assert.equal(r.json.already, true); assert.equal(r.json.refunded, 300); assert.equal(r.json.unrefunded, 0);
  assert.equal(calls("refund").length, 1); assert.equal(calls("refund")[0].params.payment_intent, "pi_2"); assert.equal(calls("refund")[0].params.amount, 20000);
  assert.equal(sc.state().bookings[0].refundedAmount, 300);
  // un secondo retry non rimborsa nulla
  const r2 = await mb(cancelRoute.POST, { slug: "casa-ortigia", b: "b-1" });
  assert.equal(r2.status, 200); assert.equal(calls("refund").length, 1);
});

test("annullamento ripetuto: prenotazione annullata a mano dal gestore (nessun rimborso riconciliato) o non rimborsabile = nessun rimborso automatico", async () => {
  mbScenario({ status: "cancelled", cancelledBy: "host", cancelledAt: new Date().toISOString(), paid: 100, stripePaymentIntent: "pi_1" });
  let r = await mb(cancelRoute.POST, { slug: "casa-ortigia", b: "b-1" });
  assert.equal(r.status, 200); assert.equal(calls("refund").length, 0);
  mbScenario({ status: "cancelled", cancelledBy: "guest", cancelledAt: new Date().toISOString(), refundable: false, paid: 100, stripePaymentIntent: "pi_1" });
  r = await mb(cancelRoute.POST, { slug: "casa-ortigia", b: "b-1" });
  assert.equal(calls("refund").length, 0);
});

test("annullamento ripetuto: se il rimborso del saldo fallisce, 502 e nessuna modifica", async () => {
  const sc = mbScenario({ status: "cancelled", cancelledBy: "host", cancelledAt: new Date().toISOString(), paid: 300, refundedAmount: 100, stripePaymentIntent: "pi_1", stripeRefundedCents: { pi_1: 10000 }, stripeExtraPayments: [{ pi: "pi_2", amount: 200 }] });
  G.__stubs.refundFail = "rete giu";
  const r = await mb(cancelRoute.POST, { slug: "casa-ortigia", b: "b-1" });
  assert.equal(r.status, 502); assert.equal(r.json.error, "refund_failed");
  assert.equal(sc.state().bookings[0].refundedAmount, 100);
});

test("GET gestisci: `unrefunded` (pagato e non rimborsato) cosi' la pagina non scrive 'nessun rimborso previsto'; l'annullamento lo scrive e lo conserva", async () => {
  const getInfo = async () => {
    const res = (await infoRoute.GET(new Request("https://xenora.test/api/mb?slug=casa-ortigia&b=b-1", { headers: { "x-forwarded-for": "9.9.9.9" } }))) as unknown as { json(): Promise<any> };
    return (await res.json()).booking;
  };
  mbScenario({ status: "cancelled", cancelledBy: "guest", cancelledAt: new Date().toISOString(), paid: 100, refundedAmount: 0 });
  assert.equal((await getInfo()).unrefunded, 100, "dati vecchi: annullata dall'ospite in finestra gratuita e non rimborsata");
  mbScenario({ status: "cancelled", cancelledBy: "guest", cancelledAt: new Date().toISOString(), paid: 100, refundedAmount: 60, unrefundedAmount: 40 });
  assert.equal((await getInfo()).unrefunded, 40);
  assert.equal(unrefundedOf({ status: "confirmed", paid: 100 }), 0);
  assert.equal(unrefundedOf({ status: "cancelled", cancelledBy: "host", paid: 100 }), 0);
  // annullamento che rimborsa solo una parte: unrefundedAmount salvato
  const sc = mbScenario({ paid: 350, paidOnline: 300, stripeExtraPayments: [{ pi: "pi_2", amount: 200 }] });
  const r = await mb(cancelRoute.POST, { slug: "casa-ortigia", b: "b-1" });
  assert.equal(r.json.unrefunded, 50); assert.equal(sc.state().bookings[0].unrefundedAmount, 50);
});

// ───────────────────────── #8/#10 preventivi ─────────────────────────
const QUOTE = { s: "Casa Ortigia", ci: day(30), co: day(33), ad: 2, ch: 0, rooms: [{ name: "Doppia", amount: 240 }], tot: 240, dep: 24, gn: "Giulia Rossi", ge: "giulia@example.com", sid: "st-1", rt: "rt-dbl", ref: "5/2026", uid: "owner-1" };
function quoteScenario(quotes: Record<string, unknown>, opts: Parameters<typeof scenario>[1] = {}) {
  const sc = scenario(baseData(), opts);
  const admin = G.__stubs.admin as Record<string, unknown>;
  G.__stubs.admin = { ...admin, rpc: async (fn: string, a: { p_code: string }) => ({ data: fn === "get_quote" ? quotes[a.p_code] ?? null : null, error: null }) };
  return sc;
}
const quoteBody = (o: Record<string, unknown> = {}) => ({ code: "abc123", successUrl: "https://test.xenora.local/preventivo?c=abc123", cancelUrl: "https://test.xenora.local/preventivo?c=abc123", ...o });

test("quote: preventivo scontato (240 su listino 300) con acconto del 10% (24 €) e' accettato; l'acconto irrisorio (0,50 €) no", async () => {
  quoteScenario({ abc123: QUOTE });
  let r = await post(quoteRoute.POST, quoteBody());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(calls("sessionCreate")[0].line_items[0].price_data.unit_amount, 2400);
  quoteScenario({ abc123: { ...QUOTE, dep: 0.5 } });
  r = await post(quoteRoute.POST, quoteBody());
  assert.equal(r.status, 400); assert.equal(r.json.error, "invalid_amount");
  // 5% del listino (15 €) e' il minimo: 14 € no, 15 € si
  quoteScenario({ abc123: { ...QUOTE, dep: 14 } });
  assert.equal((await post(quoteRoute.POST, quoteBody())).json.error, "invalid_amount");
  quoteScenario({ abc123: { ...QUOTE, dep: 15 } });
  assert.equal((await post(quoteRoute.POST, quoteBody())).status, 200);
});

test("quote (vecchio link ?q=): senza uid ma con l'email del gestore (oe) il proprietario si ricava dal profilo; politica assente = non rimborsabile con avviso, presente = rispettata", async () => {
  const legacyBody = (meta: Record<string, unknown>) => ({
    amount: 150, successUrl: "https://test.xenora.local/preventivo?c=x", cancelUrl: "https://test.xenora.local/preventivo?c=x",
    metadata: { sid: "st-1", rt: "rt-dbl", ci: day(30), co: day(33), tot: "300", dep: "150", ge: "giulia@example.com", gn: "Giulia Rossi", ref: "5/2026", ...meta },
  });
  const profiles = [{ user_id: "owner-1", email: "info@casa.example" }];
  quoteScenario({}, { profiles });
  let r = await post(quoteRoute.POST, legacyBody({ oe: "Info@Casa.example" }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let m = calls("sessionCreate")[0].metadata;
  assert.equal(m.uid, "owner-1"); assert.equal(m.rf, "0"); assert.equal(m.rfu, "1", "politica non indicata nel link: avviso al gestore");
  quoteScenario({}, { profiles });
  r = await post(quoteRoute.POST, legacyBody({ oe: "info@casa.example", refundable: "1", cancelDays: 7 }));
  m = calls("sessionCreate")[0].metadata;
  assert.equal(m.rf, "1"); assert.equal(m.cd, "7"); assert.equal(m.rfu, undefined);
  // senza uid e senza profilo corrispondente: ancora invalid_quote
  quoteScenario({}, { profiles: [] });
  r = await post(quoteRoute.POST, legacyBody({ oe: "sconosciuto@example.com" }));
  assert.equal(r.status, 400); assert.equal(r.json.error, "invalid_quote");
});

test("stripe/book: email non valida (es. 'a@b') = 400 bad_email PRIMA del pagamento, nessuna sessione creata", async () => {
  scenario(baseData());
  const r = await post(bookRoute.POST, bookBody({ guest: { firstName: "G", lastName: "R", email: "a@b", phone: "1" } }));
  assert.equal(r.status, 400); assert.equal(r.json.error, "bad_email");
  assert.equal(calls("sessionCreate").length, 0);
  assert.equal((await post(bookRoute.POST, bookBody())).status, 200, "email valida: invariato");
});
