import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Prenotazione dal sito con pagamento (/api/stripe/book + /confirm): piano, caparra e politica di cancellazione si ricalcolano sul SERVER dai piani del proprietario.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; session?: unknown; rateLimited?: boolean; chargesEnabled?: boolean; accountError?: string } };
G.__stubs = { calls: {} };
const book = await import("../src/app/api/stripe/book/route.ts");
const bookConfirm = await import("../src/app/api/stripe/book/confirm/route.ts");
const { resolvePlanPolicy, depositCentsFor } = await import("../src/lib/plan-policy.ts");

const DATA_KEY = "spigolestay:data:v1";
const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const calls = (k: string) => G.__stubs.calls[k] ?? [];

function scenario(opts: { st?: Record<string, unknown>; plans?: unknown[]; siteSid?: string; bookings?: any[]; guests?: any[] } = {}) {
  const data = {
    structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", stripeAccount: "acct_REAL", ...(opts.st ?? {}) }, { id: "st-2", name: "Altra casa", stripeAccount: "acct_ALTRA" }],
    roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia", beds: 2, basePrice: 100 }, { id: "rt-altra", structureId: "st-2", name: "Altra", beds: 2, basePrice: 100 }],
    units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }], guests: opts.guests ?? [], bookings: (opts.bookings ?? []) as any[],
  };
  const { db, client } = makeFakeDb({
    public_sites: [{ slug: "casa-ortigia", user_id: "owner-1", structure_id: opts.siteSid ?? "st-1" }],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data), ...(opts.plans ? { "spigolestay:rateplans": JSON.stringify(opts.plans) } : {}) } }],
    memberships: [], org_state: [],
  });
  Object.assign(G.__stubs, { calls: {}, admin: client, session: undefined, rateLimited: false, chargesEnabled: true, accountError: undefined });
  return { db };
}
const body = (o: Record<string, unknown> = {}) => ({
  slug: "casa-ortigia", s: "st-1", rt: "rt-dbl", ci: day(30), co: day(33), adults: 2, children: 0, total: 300, deposit: 0.5, planName: "Non rimborsabile", refundable: true, cancelDays: 0, token: "tok-1",
  guest: { firstName: "Giulia", lastName: "Rossi", email: "giulia@example.com", phone: "+393331112233", country: "IT" }, ...o,
});
const post = async (handler: (r: Request) => Promise<unknown>, b: unknown) => {
  const res = (await handler(new Request("https://xenora.test/api/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify(b) }))) as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
};
const created = () => calls("sessionCreate")[0];

test("piano non rimborsabile: la caparra di 0,50 € dichiarata dal client viene ignorata — si paga l'intero e la politica e' quella del piano", async () => {
  scenario();
  const r = await post(book.POST, body());
  assert.equal(r.status, 200); assert.equal(r.json.payment, true);
  const p = created();
  assert.equal(p.line_items[0].price_data.unit_amount, 30000);
  assert.equal(p.metadata.ref, "0", "rimborsabile:true dichiarato dal client non conta"); assert.equal(p.metadata.cd, "0");
  assert.equal(p.metadata.dep, "300");
  assert.deepEqual(p.payment_method_types, ["card"]);
  assert.equal(p.payment_intent_data.transfer_data.destination, "acct_REAL");
});

test("piano senza anticipo (Flessibile predefinito): nessun pagamento online anche se il client chiede una caparra", async () => {
  scenario();
  const r = await post(book.POST, body({ planName: "Flessibile", deposit: 100 }));
  assert.equal(r.json.payment, false);
  assert.deepEqual(r.json.policy, { refundable: true, cancelDays: 3 });
  assert.equal(calls("sessionCreate").length, 0);
});

test("piano con caparra 30% del proprietario: minimo 90 €, il client puo' pagare di piu' (fino al totale) ma non meno", async () => {
  const plans = [{ id: "p30", name: "Standard", adjPct: 0, refundable: true, cancelDays: 7, deposit: "deposit", depositPct: 30, minStay: 1 }];
  for (const [asked, want] of [[0.5, 9000], [120, 12000], [5000, 30000]] as const) {
    scenario({ plans });
    const r = await post(book.POST, body({ planName: "Standard", deposit: asked }));
    assert.equal(r.status, 200, String(asked));
    assert.equal(created().line_items[0].price_data.unit_amount, want, String(asked));
    assert.equal(created().metadata.ref, "1"); assert.equal(created().metadata.cd, "7");
    const label = created().line_items[0].price_data.product_data.name as string;
    if (want < 30000) assert.match(label, /\(caparra\)/); else assert.doesNotMatch(label, /caparra/); // "(caparra)" solo se e' un acconto parziale
  }
});

test("piano sconosciuto o non valido per quelle date/notti: prepagato e NON rimborsabile (niente scorciatoia per pagare poco)", async () => {
  scenario();
  assert.equal((await post(book.POST, body({ planName: "Inventato", refundable: true }))).json.payment, true);
  assert.equal(created().line_items[0].price_data.unit_amount, 30000); assert.equal(created().metadata.ref, "0");
  scenario();
  await post(book.POST, body({ planName: "Lunga permanenza" })); // richiede 5 notti, ne ha 3
  assert.equal(created().line_items[0].price_data.unit_amount, 30000);
});

test("senza nome del piano vale l'acconto della struttura (30% se non impostato), non rimborsabile", async () => {
  scenario();
  await post(book.POST, body({ planName: "", deposit: 1 }));
  assert.equal(created().line_items[0].price_data.unit_amount, 9000);
  scenario({ st: { depositPct: 50 } });
  await post(book.POST, body({ planName: "", deposit: 1 }));
  assert.equal(created().line_items[0].price_data.unit_amount, 15000);
});

test("struttura del sito: 's' diverso da public_sites.structure_id = 400; 's' assente usa quella del sito; il conto e' quello del sito", async () => {
  scenario();
  const r = await post(book.POST, body({ s: "st-2" }));
  assert.equal(r.status, 400); assert.equal(r.json.error, "structure_mismatch");
  assert.equal(calls("sessionCreate").length, 0);
  scenario();
  const ok = await post(book.POST, body({ s: undefined }));
  assert.equal(ok.json.payment, true); assert.equal(created().payment_intent_data.transfer_data.destination, "acct_REAL"); assert.equal(created().metadata.s, "st-1");
});

test("tipologia di un'altra struttura = 400; prezzo sotto meta' listino = 400; date impossibili = 400", async () => {
  scenario();
  assert.equal((await post(book.POST, body({ rt: "rt-altra" }))).json.error, "room_type_not_found");
  assert.equal((await post(book.POST, body({ total: 100 }))).json.error, "price_mismatch");
  assert.equal((await post(book.POST, body({ ci: "2027-02-30", co: "2027-03-02" }))).json.error, "bad_dates");
  assert.equal(calls("sessionCreate").length, 0);
});

test("conto Stripe non abilitato (charges_enabled false) o senza conto: ripiega su 'paga in struttura' (payment:false)", async () => {
  scenario(); G.__stubs.chargesEnabled = false;
  let r = await post(book.POST, body());
  assert.equal(r.json.payment, false); assert.equal(r.json.reason, "stripe_not_active"); assert.equal(calls("sessionCreate").length, 0);
  scenario({ st: { stripeAccount: "" } });
  r = await post(book.POST, body());
  assert.equal(r.json.payment, false);
  // errore di rete nella verifica del conto: non blocca (decide Checkout)
  scenario(); G.__stubs.accountError = "rete";
  assert.equal((await post(book.POST, body())).json.payment, true);
});

test("metadata Stripe: valori troppo lunghi tagliati (limite 500), eta' dei bambini e lingua inclusi; lingua dell'ospite sulla pagina di pagamento", async () => {
  scenario({ plans: [{ id: "p", name: "Standard", refundable: true, cancelDays: 2, deposit: "deposit", depositPct: 50, minStay: 1 }] });
  await post(book.POST, body({ planName: "Standard", deposit: 150, note: "x".repeat(3000), childAges: [4, 9, "boh"], children: 2, lang: "de", code: "c".repeat(200), guest: { firstName: "G".repeat(900), lastName: "R", email: "a@b.it", phone: "1", country: "DE" } }));
  const m = created().metadata;
  for (const [k, v] of Object.entries(m)) assert.ok(String(v).length <= 480, `${k} troppo lungo`);
  assert.equal(m.ca, "4,9"); assert.equal(m.lg, "de");
  assert.equal(created().locale, "de");
  assert.match(created().line_items[0].price_data.product_data.name, /Anzahlung/);
});

test("troppe richieste = 429 prima di leggere il database", async () => {
  scenario(); G.__stubs.rateLimited = true;
  const r = await post(book.POST, body());
  assert.equal(r.status, 429);
});

test("resolvePlanPolicy / depositCentsFor: casi limite", () => {
  const o = { roomTypeId: "r", checkIn: "2027-06-10", nights: 3, structureId: "s" };
  assert.deepEqual([resolvePlanPolicy(null, "flessibile", o).refundable, resolvePlanPolicy(null, "FLESSIBILE", o).depositPct], [true, 0]);
  assert.equal(resolvePlanPolicy([{ name: "A", structureId: "altra", refundable: true }], "A", o).found, false, "piano di un'altra struttura");
  assert.equal(resolvePlanPolicy([{ name: "A", roomTypeIds: ["x"], refundable: true }], "A", o).found, false, "piano di altre tipologie");
  assert.equal(resolvePlanPolicy([{ name: "A", dateFrom: "2027-07-01", refundable: true }], "A", o).found, false, "fuori stagione");
  assert.equal(resolvePlanPolicy([{ name: "A", enabled: false, refundable: true }], "A", o).found, false, "disattivato");
  assert.equal(depositCentsFor(300, 0, 0), 0); assert.equal(depositCentsFor(0, 50, 100), 0);
  assert.equal(depositCentsFor(300, 0, 30), 9000); assert.equal(depositCentsFor(333.33, 1, 33), 11000);
});

// ───────────────────────── conferma ─────────────────────────
const bookSession = (over: Record<string, unknown> = {}, meta: Record<string, string> = {}) => ({
  id: "cs_9", payment_status: "paid", amount_total: 9000, payment_intent: { id: "pi_9" },
  metadata: { kind: "book", slug: "casa-ortigia", s: "st-1", rt: "rt-dbl", ci: day(30), co: day(33), ad: "2", ch: "0", tot: "300", dep: "90", rpn: "Standard", ref: "1", cd: "7", gn: "Giulia Rossi", ge: "g@example.com", token: "tok-1", ...meta },
  ...over,
});

test("conferma: registra tramite public-booking con l'importo INCASSATO (non quello dei metadata) e la politica scritta dal server", async () => {
  scenario(); G.__stubs.session = bookSession({}, { dep: "999" });
  const r = await post(bookConfirm.POST, { session_id: "cs_9", slug: "casa-ortigia" });
  assert.equal(r.status, 200);
  const c = calls("internalFetch")[0];
  assert.match(c.url, /\/api\/public-booking$/);
  assert.equal(c.body.deposit, 90); assert.equal(c.body.refundable, true); assert.equal(c.body.cancelDays, 7); assert.equal(c.body.stripeAccountId, "acct_REAL"); assert.equal(c.body.stripePaymentIntent, "pi_9");
});

test("conferma: sessione di un'altra struttura / non 'book' / non pagata / struttura senza conto = rifiutata", async () => {
  scenario(); G.__stubs.session = bookSession({}, { slug: "altro-sito" });
  assert.equal((await post(bookConfirm.POST, { session_id: "cs_9", slug: "casa-ortigia" })).json.error, "not_a_booking_session");
  scenario(); G.__stubs.session = bookSession({}, { kind: "quote" });
  assert.equal((await post(bookConfirm.POST, { session_id: "cs_9", slug: "casa-ortigia" })).status, 400);
  scenario(); G.__stubs.session = bookSession({ payment_status: "unpaid" });
  assert.equal((await post(bookConfirm.POST, { session_id: "cs_9", slug: "casa-ortigia" })).status, 402);
  scenario({ st: { stripeAccount: "" } }); G.__stubs.session = bookSession();
  assert.equal((await post(bookConfirm.POST, { session_id: "cs_9", slug: "casa-ortigia" })).json.error, "no_stripe_account");
  assert.equal(calls("internalFetch").length, 0);
});

test("conferma: la risposta contiene il riepilogo `booking` letto da /prenota (dai metadata se la prenotazione non e' ancora rileggibile)", async () => {
  scenario({ st: { cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2, cityTaxMaxNights: 3 } }); G.__stubs.session = bookSession({}, { code: "CAS-123", ge: "giulia@example.com" });
  const r = await post(bookConfirm.POST, { session_id: "cs_9", slug: "casa-ortigia" });
  assert.equal(r.json.ok, true);
  const b = r.json.booking;
  assert.equal(b.code, "CAS-123"); assert.equal(b.structureName, "Casa Ortigia"); assert.equal(b.roomName, "Doppia · Standard");
  assert.equal(b.ci, day(30)); assert.equal(b.co, day(33));
  assert.equal(b.cityTax, 12, "2 adulti × 3 notti × 2 €"); assert.equal(b.grandTotal, 312); assert.equal(b.paid, 90);
  assert.deepEqual([b.guestFirst, b.guestLast, b.adults, b.children, b.email], ["Giulia", "Rossi", 2, 0, "giulia@example.com"]);
});

test("conferma: con already:true il riepilogo viene dalla prenotazione GIA' registrata (codice, importi e ospite reali)", async () => {
  scenario({
    st: { cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2, cityTaxMaxNights: 3 },
    guests: [{ id: "g1", firstName: "Giulia", lastName: "Bianchi", email: "nuova@example.com" }],
    bookings: [{ id: "abcdef12-0000", extId: "site:casa-ortigia:tok-1", structureId: "st-1", roomTypeId: "rt-dbl", guestId: "g1", channel: "direct", status: "confirmed", checkIn: day(30), checkOut: day(33), adults: 2, children: 0, total: 310, paid: 100, code: "REALE-9" }],
  });
  G.__stubs.session = bookSession();
  const r = await post(bookConfirm.POST, { session_id: "cs_9", slug: "casa-ortigia" });
  const b = r.json.booking;
  assert.equal(b.code, "REALE-9"); assert.equal(b.paid, 100); assert.equal(b.grandTotal, 322); assert.equal(b.cityTax, 12);
  assert.equal(b.guestLast, "Bianchi"); assert.equal(b.email, "nuova@example.com");
});
