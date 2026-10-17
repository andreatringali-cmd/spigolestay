import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Webhook Stripe: i pagamenti di preventivi / saldi dal check-in si registrano anche senza il ritorno pagina; il sito usa l'importo INCASSATO e i childAges;
// rimborsi e dispute si ritrovano dai metadata e un rimborso parziale scala paid una sola volta.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_finto";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; event?: unknown; session?: unknown; piMeta?: Record<string, string>; refundsDb?: any[] } };
G.__stubs = { calls: {} };
const { POST } = await import("../src/app/api/stripe/webhook/route.ts");
const { applyRefundToBooking } = await import("../src/lib/stripe-reconcile.ts");
const { publicBookingBodyFromSession } = await import("../src/lib/book-session.ts");

const DATA_KEY = "spigolestay:data:v1";
const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const calls = (k: string) => G.__stubs.calls[k] ?? [];

const ST = { id: "st-1", name: "Casa Ortigia", email: "info@casa.example", stripeAccount: "acct_REAL" };
const baseData = (bookings: any[] = []) => ({ structures: [ST], roomTypes: [{ id: "rt-1", structureId: "st-1", name: "Doppia", basePrice: 100 }], units: [{ id: "u1", roomTypeId: "rt-1", structureId: "st-1" }, { id: "u2", roomTypeId: "rt-1", structureId: "st-1" }], guests: [{ id: "g1", firstName: "Giulia", lastName: "Rossi", email: "g@example.com" }], bookings });
function env(bookings: any[] = [], orgBookings?: any[]) {
  const { db, client } = makeFakeDb({
    profiles: [], platform_fees: [], public_sites: [{ slug: "casa", user_id: "owner-1", structure_id: "st-1" }],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(baseData(orgBookings ? [] : bookings)) } }, { user_id: "altro-utente", rev: 1, data: { [DATA_KEY]: JSON.stringify(baseData([])) } }],
    memberships: orgBookings ? [{ user_id: "owner-1", org_id: "org-1" }] : [], org_state: orgBookings ? [{ org_id: "org-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(baseData(orgBookings)) } }] : [],
  });
  Object.assign(G.__stubs, { calls: {}, admin: client, event: undefined, session: undefined, piMeta: undefined, refundsDb: [] });
  return { db, books: () => (JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]).bookings as any[]), orgBooks: () => (JSON.parse((db.tables.org_state[0].data as any)[DATA_KEY]).bookings as any[]) };
}
async function hook(event: unknown) {
  G.__stubs.event = event;
  const res = (await POST(new Request("https://xenora.test/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" }))) as unknown as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
}
const completed = (session: Record<string, unknown>) => ({ type: "checkout.session.completed", data: { object: session } });
const sess = (metadata: Record<string, string>, amount_total: number, id = "cs_1") => ({ id, mode: "payment", payment_status: "paid", amount_total, metadata, payment_intent: { id: "pi_" + id, transfer_data: { destination: "acct_REAL" } } });

test("firma non valida = 400", async () => {
  env(); G.__stubs.event = undefined;
  const res = (await POST(new Request("https://xenora.test/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "x" }, body: "{}" }))) as unknown as { status: number };
  assert.equal(res.status, 400);
});

// ───────────────────────── sito: kind "book" ─────────────────────────
test("book: il webhook passa a public-booking l'importo INCASSATO (amount_total), la politica scritta dal server e i childAges", async () => {
  env(); (G.__stubs as any).piDest = "acct_REAL";
  const meta = { kind: "book", slug: "casa", s: "st-1", rt: "rt-1", ci: day(30), co: day(33), ad: "2", ch: "2", ca: "4,9", tot: "300", dep: "150", rpn: "Flessibile", ref: "1", cd: "3", gn: "Giulia Rossi", ge: "g@example.com", token: "tok" };
  const r = await hook(completed(sess(meta, 14999)));
  assert.equal(r.status, 200);
  const c = calls("internalFetch")[0];
  assert.match(c.url, /\/api\/public-booking$/);
  assert.equal(c.body.deposit, 149.99, "versato = amount_total/100, non il 'dep' dei metadata");
  assert.deepEqual(c.body.childAges, [4, 9]);
  assert.equal(c.body.refundable, true); assert.equal(c.body.cancelDays, 3); assert.equal(c.body.stripePaymentIntent, "pi_cs_1"); assert.equal(c.body.stripeAccountId, "acct_REAL");
});

test("publicBookingBodyFromSession: senza età dei bambini non manda childAges; nome e ospite scomposti", () => {
  const b = publicBookingBodyFromSession({ id: "cs", amount_total: 5000, metadata: { rt: "r", ci: "2027-01-01", co: "2027-01-02", ad: "x", gn: "Anna Maria Bianchi", ge: "a@b.it", lg: "de" } }, { slug: "s", paymentIntent: "pi", accountId: "acct" });
  assert.equal("childAges" in b, false); assert.equal(b.adults, 1); assert.equal(b.deposit, 50);
  assert.deepEqual(b.guest, { firstName: "Anna", lastName: "Maria Bianchi", email: "a@b.it", phone: "", country: "", language: "de" });
});

// ───────────────────────── preventivo e saldo check-in senza ritorno pagina ─────────────────────────
const QMETA = { kind: "quote", uid: "owner-1", sid: "st-1", rt: "rt-1", ci: day(30), co: day(33), ad: "2", ch: "0", tot: "300", acc: "300", dep: "150", rl: "rt-1~1~30000", ref: "5/2026", qc: "abc", gn: "Giulia Rossi", ge: "g@example.com" };

test("quote: il webhook registra la prenotazione del preventivo pagato anche se l'ospite non torna sul sito, una sola volta", async () => {
  const e = env();
  G.__stubs.session = sess(QMETA, 15000);
  assert.equal((await hook(completed(sess(QMETA, 15000)))).status, 200);
  assert.equal(e.books().length, 1);
  assert.equal(e.books()[0].paid, 150); assert.equal(e.books()[0].stripePaymentIntent, "pi_cs_1"); assert.equal(e.books()[0].extId, "quote:owner-1:abc");
  assert.equal((await hook(completed(sess(QMETA, 15000)))).status, 200); // retry di Stripe
  assert.equal(e.books().length, 1);
});

test("quote: importo diverso da quello deciso dal server = nessuna prenotazione (errore definitivo, niente retry infiniti)", async () => {
  const e = env();
  G.__stubs.session = sess(QMETA, 50);
  const r = await hook(completed(sess(QMETA, 50)));
  assert.equal(r.status, 200);
  assert.equal(e.books().length, 0);
});

test("saldo check-in: il webhook registra l'incasso sulla prenotazione senza il ritorno pagina", async () => {
  const bk = { id: "b-1", structureId: "st-1", roomTypeId: "rt-1", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: day(5), checkOut: day(8), total: 300, paid: 100, adults: 2, children: 0 };
  const e = env([bk]);
  const s = sess({ kind: "quote", bookingId: "b-1" }, 20000, "cs_bal");
  G.__stubs.session = s;
  assert.equal((await hook(completed(s))).status, 200);
  assert.equal(e.books()[0].paid, 300);
  assert.equal((await hook(completed(s))).status, 200);
  assert.equal(e.books()[0].paid, 300);
});

test("chatpay: eccedenza rimborsata dal webhook", async () => {
  const bk = { id: "b-1", structureId: "st-1", roomTypeId: "rt-1", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: day(5), checkOut: day(8), total: 300, paid: 250, adults: 2, children: 0 };
  const e = env([bk]);
  const r = await hook(completed({ ...sess({ kind: "chatpay", bid: "b-1", uid: "owner-1", pk: "saldo" }, 8000, "cs_c"), payment_intent: "pi_c" }));
  assert.equal(r.status, 200);
  assert.equal(e.books()[0].paid, 300);
  assert.equal(calls("refund")[0].params.amount, 3000);
});

// ───────────────────────── rimborsi e dispute ─────────────────────────
const chargeEvent = (type: string, ch: Record<string, unknown>) => ({ type, data: { object: { object: "charge", ...ch } } });

test("applyRefundToBooking: rimborso parziale scala paid/paidOnline una sola volta (cumulato annotato) e non annulla", () => {
  const bk = { id: "b", status: "confirmed", paid: 200, paidOnline: 200, stripePaymentIntent: "pi_1" };
  const a = applyRefundToBooking(bk, "pi_1", { amount: 20000, amountRefunded: 5000 }, false, 1)!;
  assert.equal(a.paid, 150); assert.equal(a.paidOnline, 150); assert.equal(a.status, "confirmed"); assert.deepEqual(a.stripeRefundedCents, { pi_1: 5000 });
  assert.match(String(a.note), /Rimborso parziale Stripe € 50,00/);
  assert.equal(applyRefundToBooking(a, "pi_1", { amount: 20000, amountRefunded: 5000 }, false, 2), null, "stesso evento ripetuto = niente");
  const b = applyRefundToBooking(a, "pi_1", { amount: 20000, amountRefunded: 8000 }, false, 3)!;
  assert.equal(b.paid, 120); // solo i 30 € in piu'
});

test("applyRefundToBooking: rimborso TOTALE del pagamento principale annulla; di un pagamento successivo (saldo) scala soltanto", () => {
  const main = applyRefundToBooking({ id: "b", status: "confirmed", paid: 200, stripePaymentIntent: "pi_1" }, "pi_1", { amount: 20000, amountRefunded: 20000 }, false, 1)!;
  assert.equal(main.status, "cancelled"); assert.equal(main.refundedAmount, 200);
  const extra = applyRefundToBooking({ id: "b", status: "confirmed", paid: 300, stripePaymentIntent: "pi_1", stripeExtraPayments: [{ pi: "pi_2", amount: 100 }] }, "pi_2", { amount: 10000, amountRefunded: 10000 }, false, 1)!;
  assert.equal(extra.status, "confirmed"); assert.equal(extra.paid, 200); assert.deepEqual(extra.stripeExtraPayments, [{ pi: "pi_2", amount: 0 }]);
  assert.equal(applyRefundToBooking({ id: "b", paid: 1, stripePaymentIntent: "pi_9" }, "pi_1", { amount: 1, amountRefunded: 1 }, false, 1), null, "PI non della prenotazione");
});

test("applyRefundToBooking: dispute segnalata una sola volta", () => {
  const d = applyRefundToBooking({ id: "b", paid: 1, stripePaymentIntent: "pi_1" }, "pi_1", { amount: 100, amountRefunded: 0 }, true, 1)!;
  assert.equal(d.dispute, true); assert.match(String(d.note), /Dispute/);
  assert.equal(applyRefundToBooking(d, "pi_1", { amount: 100, amountRefunded: 0 }, true, 2), null);
});

test("charge.refunded parziale: localizzata dai metadata (uid) senza scorrere tutte le righe; paid scende", async () => {
  const bk = { id: "b-1", structureId: "st-1", roomTypeId: "rt-1", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: day(5), checkOut: day(8), total: 300, paid: 200, stripePaymentIntent: "pi_1" };
  const e = env([bk]);
  const r = await hook(chargeEvent("charge.refunded", { amount: 20000, amount_refunded: 5000, payment_intent: "pi_1", metadata: { uid: "owner-1" } }));
  assert.equal(r.status, 200);
  assert.equal(e.books()[0].paid, 150); assert.equal(e.books()[0].status, "confirmed");
  // niente scansione dell'altro utente: nel log delle letture c'e' solo il proprietario
  const reads = e.db.log.filter((l) => l.op === "select" && l.table === "app_state").map((l) => JSON.stringify(l.filters));
  assert.ok(!reads.some((f) => f.includes("altro-utente")), "non deve scorrere le righe degli altri tenant");
});

test("charge.refunded senza metadata: i metadata si leggono dal PaymentIntent; poi nell'organizzazione", async () => {
  const bk = { id: "b-1", structureId: "st-1", roomTypeId: "rt-1", status: "confirmed", channel: "direct", checkIn: day(5), checkOut: day(8), total: 300, paid: 200, stripePaymentIntent: "pi_1" };
  const e = env([], [bk]);
  G.__stubs.piMeta = { slug: "casa" };
  const r = await hook(chargeEvent("charge.refunded", { amount: 20000, amount_refunded: 20000, payment_intent: "pi_1", metadata: {} }));
  assert.equal(r.status, 200);
  assert.equal(e.orgBooks()[0].status, "cancelled");
});

test("charge.dispute.created: prenotazione segnalata", async () => {
  const bk = { id: "b-1", structureId: "st-1", roomTypeId: "rt-1", status: "confirmed", channel: "direct", checkIn: day(5), checkOut: day(8), total: 300, paid: 200, stripePaymentIntent: "pi_1" };
  const e = env([bk]);
  G.__stubs.piMeta = { uid: "owner-1" };
  const r = await hook({ type: "charge.dispute.created", data: { object: { object: "dispute", payment_intent: "pi_1", metadata: {} } } });
  assert.equal(r.status, 200);
  assert.equal(e.books()[0].dispute, true);
});
