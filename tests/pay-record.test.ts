import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Registrazione degli incassi online sul server: link di pagamento in chat (recordChatPayment) e saldo dal check-in (recordCheckinPayment).
// Prenotazione annullata, doppio pagamento (eccedenza rimborsata una sola volta), PaymentIntent salvato, tassa di soggiorno, avvisi al titolare.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; refundFail?: string; refundsDb?: any[] } };
G.__stubs = { calls: {} };
const { planChatPayment, applyChatPayment } = await import("../src/lib/chat-pay-core.ts");
const { recordChatPayment } = await import("../src/lib/chat-pay-server.ts");
const { recordCheckinPayment } = await import("../src/lib/checkin-pay.ts");
const { findBookingStoreById } = await import("../src/lib/manage-booking.ts");
const { ymdRome } = await import("../src/lib/dates-rome.ts");

const DATA_KEY = "spigolestay:data:v1";
const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const calls = (k: string) => G.__stubs.calls[k] ?? [];

const ST = { id: "st-1", name: "Casa Ortigia", email: "info@casa.example", stripeAccount: "acct_REAL", stripeChargesEnabled: true, cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2 };
const BK = { id: "b-1", structureId: "st-1", roomTypeId: "rt-1", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: day(5), checkOut: day(8), total: 300, paid: 100, adults: 2, children: 0 };

function env(bookings: Record<string, unknown>[], opts: { blobExtra?: Record<string, string>; st?: Record<string, unknown> } = {}) {
  const data = { structures: [{ ...ST, ...(opts.st ?? {}) }], roomTypes: [{ id: "rt-1", structureId: "st-1", name: "Doppia" }], units: [{ id: "u1", roomTypeId: "rt-1", structureId: "st-1" }], guests: [{ id: "g1", firstName: "Giulia", lastName: "Rossi", email: "g@example.com" }], bookings };
  const { db, client } = makeFakeDb({ app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data), ...(opts.blobExtra ?? {}) } }], memberships: [], org_state: [] });
  Object.assign(G.__stubs, { calls: {}, admin: client, refundFail: undefined, refundsDb: [] });
  return { db, client: client as never, books: () => (JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]).bookings as any[]), threads: () => JSON.parse((db.tables.app_state[0].data as any)["spigolestay:threads:v1"] || "{}") };
}
const cps = (metadata: Record<string, string>, amount_total: number, id = "cs_1", pi = "pi_1") => ({ id, payment_status: "paid", amount_total, metadata, payment_intent: pi });
const chatMeta = { kind: "chatpay", bid: "b-1", uid: "owner-1", pk: "saldo" };

// ───────────────────────── logica pura ─────────────────────────
test("planChatPayment: prenotazione annullata o no-show = errore 'cancelled' (anche con tutto il resto in regola)", () => {
  const ctx = { totalCents: 30000, balanceCents: 20000, cityTaxCents: 1200, stripeAccount: "acct_1", stripeChargesEnabled: true };
  assert.equal(planChatPayment(ctx, "saldo").ok, true);
  for (const bookingStatus of ["cancelled", "no_show"]) {
    const p = planChatPayment({ ...ctx, bookingStatus }, "saldo");
    assert.equal(p.ok, false); assert.equal((p as any).error, "cancelled"); assert.match((p as any).message, /annullata/);
  }
});

test("applyChatPayment: ogni incasso online lascia payment intent (stripeExtraPayments), metodo carta se non scelto, paidOnline e data Roma", () => {
  const r = applyChatPayment({ id: "b", paid: 0 }, { sessionId: "cs_1", cents: 5000, kind: "saldo", balanceBeforeCents: 20000, cityTaxCents: 0, now: Date.now(), paymentIntent: "pi_x" });
  assert.deepEqual(r.booking.stripeExtraPayments, [{ pi: "pi_x", amount: 50 }]);
  assert.equal(r.booking.paymentMethod, "carta"); assert.equal(r.booking.paidOnline, 50); assert.equal(r.booking.paidAt, ymdRome(Date.now()));
  // il metodo scelto a mano resta; lo stesso PI non si duplica; il PI principale non va tra gli extra
  const keep = applyChatPayment({ id: "b", paid: 0, paymentMethod: "bonifico", stripePaymentIntent: "pi_main" }, { sessionId: "cs_2", cents: 1000, kind: "saldo", balanceBeforeCents: 5000, cityTaxCents: 0, now: 1, paymentIntent: "pi_main" });
  assert.equal(keep.booking.paymentMethod, "bonifico"); assert.equal(keep.booking.stripeExtraPayments, undefined);
});

// ───────────────────────── link di pagamento in chat ─────────────────────────
test("chat-pay: pagamento regolare = incasso + PaymentIntent + messaggio in chat, nessun rimborso", async () => {
  const e = env([{ ...BK }], { st: { cityTax: false } });
  const r = await recordChatPayment(e.client, cps(chatMeta, 20000) as never);
  assert.equal(r.ok, true);
  const b = e.books()[0];
  assert.equal(b.paid, 300); assert.deepEqual(b.stripeExtraPayments, [{ pi: "pi_1", amount: 200 }]); assert.equal(b.paymentMethod, undefined, "100 € erano gia' incassati senza metodo: non si dichiara carta per tutta la prenotazione"); assert.deepEqual(b.paidSessions, ["cs_1"]);
  assert.equal(calls("refund").length, 0);
  assert.match(e.threads()["g1"][0].text, /Pagamento ricevuto € 200,00/);
});

test("chat-pay: due click (due sessioni) sullo stesso residuo — la seconda eccede, si registra solo il residuo e l'eccedenza si rimborsa UNA volta", async () => {
  const e = env([{ ...BK }], { st: { cityTax: false } });
  await recordChatPayment(e.client, cps(chatMeta, 20000, "cs_1", "pi_1") as never);
  const r2 = await recordChatPayment(e.client, cps(chatMeta, 20000, "cs_2", "pi_2") as never);
  assert.equal(r2.ok, true);
  const b = e.books()[0];
  assert.equal(b.paid, 300, "l'incasso non supera il totale");
  const rf = calls("refund");
  assert.equal(rf.length, 1); assert.equal(rf[0].params.payment_intent, "pi_2"); assert.equal(rf[0].params.amount, 20000); assert.equal(rf[0].params.reverse_transfer, true);
  assert.equal(rf[0].opts.idempotencyKey, "chatpay-excess-cs_2");
  assert.equal(b.stripeExtraPayments.some((x: any) => x.pi === "pi_2"), false, "il pagamento rimborsato non e' un incasso della prenotazione");
  assert.match(e.threads()["g1"].at(-1).text, /rimborsata automaticamente/);
  // webhook + ritorno pagina + retry: nessun secondo rimborso
  await recordChatPayment(e.client, cps(chatMeta, 20000, "cs_2", "pi_2") as never);
  await recordChatPayment(e.client, cps(chatMeta, 20000, "cs_2", "pi_2") as never);
  assert.equal(calls("refund").length, 1);
  assert.equal(e.books()[0].paid, 300);
});

test("chat-pay: pagamento parzialmente in eccesso (residuo 50, pagati 80) = registra 50, rimborsa 30", async () => {
  const e = env([{ ...BK, paid: 250 }], { st: { cityTax: false } });
  await recordChatPayment(e.client, cps(chatMeta, 8000) as never);
  assert.equal(e.books()[0].paid, 300);
  assert.equal(calls("refund")[0].params.amount, 3000);
  assert.deepEqual(e.books()[0].stripeExtraPayments, [{ pi: "pi_1", amount: 50 }]);
});

test("chat-pay: prenotazione annullata nel frattempo = incasso NON registrato e rimborso totale", async () => {
  const e = env([{ ...BK, status: "cancelled" }], { st: { cityTax: false } });
  const r = await recordChatPayment(e.client, cps(chatMeta, 20000) as never);
  assert.equal(r.ok, true);
  const b = e.books()[0];
  assert.equal(b.paid, 100); assert.equal(b.status, "cancelled");
  assert.equal(calls("refund")[0].params.amount, 20000);
  assert.match(e.threads()["g1"][0].text, /annullata/);
});

test("chat-pay: rimborso non riuscito = ok:false (il webhook ritenta) e al retry il rimborso viene riprovato, senza registrare due volte l'incasso", async () => {
  const e = env([{ ...BK }], { st: { cityTax: false } });
  await recordChatPayment(e.client, cps(chatMeta, 20000, "cs_1", "pi_1") as never);
  G.__stubs.refundFail = "rete giu";
  const r = await recordChatPayment(e.client, cps(chatMeta, 20000, "cs_2", "pi_2") as never);
  assert.equal(r.ok, false); assert.equal((r as any).error, "refund_failed");
  assert.equal(e.books()[0].paid, 300);
  G.__stubs.refundFail = undefined;
  const r2 = await recordChatPayment(e.client, cps(chatMeta, 20000, "cs_2", "pi_2") as never);
  assert.equal(r2.ok, true);
  assert.equal(calls("refund").length, 2); // 1 tentativo fallito + 1 riuscito
  assert.equal(e.books()[0].paid, 300);
});

test("chat-pay: tassa di soggiorno pagata col link = cityTaxPaid e cityTaxInPaid (i soldi sono dentro paid)", async () => {
  const e = env([{ ...BK, paid: 300 }]); // soggiorno saldato, resta la tassa: 2 persone x 3 notti x 2 € = 12 €
  const r = await recordChatPayment(e.client, cps({ ...chatMeta, pk: "tassa" }, 1200) as never);
  assert.equal(r.ok, true);
  const b = e.books()[0];
  assert.equal(b.paid, 312); assert.equal(b.cityTaxPaid, true); assert.equal(b.cityTaxInPaid, true);
});

// ───────────────────────── saldo dal check-in ─────────────────────────
const ckMeta = { kind: "quote", bookingId: "b-1" };
const full = (metadata: Record<string, string>, amount_total: number, id = "cs_1", dest = "acct_REAL") => ({ id, payment_status: "paid", amount_total, metadata, payment_intent: { id: "pi_" + id, transfer_data: { destination: dest } } });
async function checkin(e: ReturnType<typeof env>, session: unknown, bid = "b-1") {
  const store = await findBookingStoreById(e.client, bid);
  assert.ok(store, "prenotazione trovata");
  return recordCheckinPayment(e.client, store!, session as never, { origin: "https://test.xenora.local" });
}

test("check-in: camera singola — incasso con PaymentIntent, carta, paidOnline/paidAt e flag tassa quando il saldo azzera il residuo", async () => {
  const e = env([{ ...BK }]); // totale 300 + tassa 12 = 312, pagati 100 -> residuo 212
  const r = await checkin(e, full(ckMeta, 21200));
  assert.equal(r.ok, true); assert.equal((r as any).amount, 212);
  const b = e.books()[0];
  assert.equal(b.paid, 312); assert.equal(b.cityTaxPaid, true, "come nel ramo gruppo: il saldo comprende la tassa"); assert.equal(b.cityTaxInPaid, true);
  assert.deepEqual(b.stripeExtraPayments, [{ pi: "pi_cs_1", amount: 212 }]); assert.equal(b.paymentMethod, undefined); assert.equal(b.paidOnline, 212); assert.equal(b.paidAt, ymdRome(Date.now()));
  assert.equal(calls("refund").length, 0);
});

test("check-in: pagamento parziale non tocca i flag della tassa", async () => {
  const e = env([{ ...BK }]);
  await checkin(e, full(ckMeta, 5000));
  const b = e.books()[0];
  assert.equal(b.paid, 150); assert.equal(b.cityTaxPaid, undefined);
});

test("check-in: idempotente — webhook e ritorno pagina insieme = un solo incasso", async () => {
  const e = env([{ ...BK }]);
  const s = full(ckMeta, 21200);
  await checkin(e, s);
  const r2 = await checkin(e, s);
  assert.equal(r2.ok, true); assert.equal((r2 as any).already, true);
  assert.equal(e.books()[0].paid, 312);
});

test("check-in: doppio pagamento — registra solo il residuo e rimborsa l'eccedenza (una volta)", async () => {
  const e = env([{ ...BK }]);
  await checkin(e, full(ckMeta, 21200, "cs_1"));
  const r = await checkin(e, full(ckMeta, 21200, "cs_2"));
  assert.equal(r.ok, true);
  assert.equal(e.books()[0].paid, 312);
  assert.equal(calls("refund").length, 1); assert.equal(calls("refund")[0].params.amount, 21200); assert.equal(calls("refund")[0].opts.idempotencyKey, "checkin-excess-cs_2");
  await checkin(e, full(ckMeta, 21200, "cs_2"));
  assert.equal(calls("refund").length, 1);
});

test("check-in: prenotazione annullata = niente incasso e rimborso totale", async () => {
  const e = env([{ ...BK, status: "cancelled" }]);
  const r = await checkin(e, full(ckMeta, 21200));
  assert.equal(r.ok, true);
  assert.equal(e.books()[0].paid, 100);
  assert.equal(calls("refund")[0].params.amount, 21200);
});

test("check-in: sessione di un'altra prenotazione o accreditata a un altro conto = rifiutata", async () => {
  const e = env([{ ...BK }]);
  const a = await checkin(e, full({ ...ckMeta, bookingId: "b-9" }, 5000));
  assert.deepEqual([a.ok, (a as any).error], [false, "session_mismatch"]);
  const b = await checkin(e, full(ckMeta, 5000, "cs_1", "acct_ATTACKER"));
  assert.deepEqual([b.ok, (b as any).error], [false, "session_account_mismatch"]);
  assert.equal(e.books()[0].paid, 100);
});

test("check-in: avviso 'Pagamento ricevuto' al titolare SOLO se acceso nelle Impostazioni (di default e' spento)", async () => {
  let e = env([{ ...BK }]);
  await checkin(e, full(ckMeta, 5000));
  assert.equal(calls("internalFetch").length, 0, "toggle spento di default: nessuna email");
  e = env([{ ...BK }], { blobExtra: { "spigolestay:notifs": JSON.stringify({ payment: true }) } });
  await checkin(e, full(ckMeta, 5000));
  const n = calls("internalFetch")[0];
  assert.equal(n.body.kind, "notify"); assert.equal(n.body.event, "payment"); assert.equal(n.body.to, "info@casa.example");
  assert.match(n.body.subject, /Pagamento ricevuto/); assert.match(n.body.text, /€ 50,00/);
  await checkin(e, full(ckMeta, 5000)); // ripetuto: nessun secondo avviso
  assert.equal(calls("internalFetch").length, 1);
});

test("check-in di GRUPPO: l'importo si ripartisce sui residui con la quota di tassa del gruppo, l'eccedenza si rimborsa", async () => {
  const g = (id: string, over: Record<string, unknown> = {}) => ({ ...BK, id, groupId: "grp", paid: 0, total: 200, adults: 2, ...over });
  // tassa di gruppo: 4 adulti x 3 notti x 2 € = 24 €, 12 € a camera -> residuo 212 ciascuna (424 in tutto)
  const e = env([g("b-1"), g("b-2")]);
  const r = await checkin(e, full({ ...ckMeta, group: "1" }, 45000)); // 450 pagati: 26 in piu' del dovuto
  assert.equal(r.ok, true);
  const bs = e.books();
  assert.deepEqual(bs.map((b) => b.paid), [212, 212]);
  assert.deepEqual(bs.map((b) => b.cityTaxPaid), [true, true]);
  assert.equal(calls("refund")[0].params.amount, 2600);
  for (const b of bs) assert.deepEqual(b.stripeExtraPayments, [{ pi: "pi_cs_1", amount: 212 }]);
});

// ───────────────────────── gruppo: residuo con la quota di tassa del gruppo anche sul server ─────────────────────────
test("chatPayContext: camera di un gruppo = totale e residuo con la QUOTA di tassa del gruppo (non quella della camera da sola)", async () => {
  const { chatPayContext } = await import("../src/lib/chat-pay.ts");
  const st = { id: "st-1", name: "X", cityTax: true, cityTaxMode: "percent", cityTaxPercent: 4, cityTaxCap: 5, cityTaxMaxNights: 7, stripeAccount: "acct_1", stripeChargesEnabled: true } as never;
  const a = { id: "a", structureId: "st-1", groupId: "g", status: "confirmed", channel: "direct", checkIn: "2027-05-10", checkOut: "2027-05-13", adults: 1, children: 0, total: 900, paid: 100 };
  const b = { id: "b", structureId: "st-1", groupId: "g", status: "confirmed", channel: "direct", checkIn: "2027-05-10", checkOut: "2027-05-13", adults: 3, children: 0, total: 300, paid: 0 };
  const ctxA = chatPayContext(a as never, st, false, [a, b] as never);
  const ctxB = chatPayContext(b as never, st, false, [a, b] as never);
  assert.equal(ctxA.cityTaxCents, 1200); assert.equal(ctxB.cityTaxCents, 3600); // 48 € di gruppo ripartiti per paganti (1 e 3)
  assert.equal(ctxA.totalCents, 91200); assert.equal(ctxA.balanceCents, 91200 - 10000);
  assert.equal(ctxB.totalCents, 33600); assert.equal(ctxB.balanceCents, 33600);
  // da sola la stessa camera avrebbe avuto una tassa diversa (15 €): il residuo sarebbe sbagliato
  const alone = chatPayContext(a as never, st, false, [a] as never);
  assert.equal(alone.cityTaxCents, 1500);
});

// ───────────────────────── H1: eccedenza e rimborsi manuali (marcatore dedicato) ─────────────────────────
const { applyRefundToBooking, planRefundOnBookings } = await import("../src/lib/stripe-reconcile.ts");
function mutBooks(e: ReturnType<typeof env>, fn: (b: any) => any) {
  const row = e.db.tables.app_state[0] as any;
  const d = JSON.parse(row.data[DATA_KEY]);
  d.bookings = d.bookings.map(fn);
  row.data[DATA_KEY] = JSON.stringify(d);
}

test("chat-pay: rimborso MANUALE del titolare + rielaborazione della stessa sessione (ritorno pagina/retry) = nessun secondo rimborso", async () => {
  const e = env([{ ...BK, paid: 100 }], { st: { cityTax: false } });
  await recordChatPayment(e.client, cps(chatMeta, 20000, "cs_1", "pi_1") as never);
  assert.equal(e.books()[0].paid, 300);
  // il titolare rimborsa 20 € dalla dashboard Stripe: la riconciliazione annota il cumulato in stripeRefundedCents
  mutBooks(e, (b) => applyRefundToBooking(b, "pi_1", { amount: 20000, amountRefunded: 2000 }, false, Date.now()) ?? b);
  assert.deepEqual(e.books()[0].stripeRefundedCents, { pi_1: 2000 });
  const r = await recordChatPayment(e.client, cps(chatMeta, 20000, "cs_1", "pi_1") as never);
  assert.equal(r.ok, true);
  assert.equal(calls("refund").length, 0, "il rimborso manuale non e' una eccedenza da rimborsare di nuovo");
  assert.equal(e.books()[0].paid, 280);
});

test("chat-pay: eccedenza vera + rimborso manuale successivo: al retry si rimborsa ancora solo l'eccedenza originale (e una volta)", async () => {
  const e = env([{ ...BK, paid: 250 }], { st: { cityTax: false } });
  await recordChatPayment(e.client, cps(chatMeta, 8000, "cs_1", "pi_1") as never); // residuo 50, pagati 80: eccedenza 30
  assert.equal(calls("refund").length, 1); assert.equal(calls("refund")[0].params.amount, 3000);
  assert.deepEqual(e.books()[0].stripeExcessRefunded, { pi_1: 3000 });
  mutBooks(e, (b) => applyRefundToBooking(b, "pi_1", { amount: 8000, amountRefunded: 3000 + 1000 }, false, Date.now()) ?? b); // + 10 € manuali
  await recordChatPayment(e.client, cps(chatMeta, 8000, "cs_1", "pi_1") as never);
  assert.equal(calls("refund").length, 1, "stessa chiave di idempotenza: nessun nuovo rimborso");
});

test("check-in: rimborso MANUALE del titolare + rielaborazione della sessione = nessun secondo rimborso", async () => {
  const e = env([{ ...BK }]);
  await checkin(e, full(ckMeta, 21200, "cs_1"));
  mutBooks(e, (b) => applyRefundToBooking(b, "pi_cs_1", { amount: 21200, amountRefunded: 2000 }, false, Date.now()) ?? b);
  const r = await checkin(e, full(ckMeta, 21200, "cs_1"));
  assert.equal(r.ok, true);
  assert.equal(calls("refund").length, 0);
});

// ───────────────────────── H1 #17: metodo "carta" solo al primo incasso ─────────────────────────
test("applyChatPayment: il metodo carta si imposta solo se non c'era nulla di incassato prima (contanti senza metodo restano tali)", () => {
  const first = applyChatPayment({ id: "b", paid: 0 }, { sessionId: "cs_1", cents: 5000, kind: "saldo", balanceBeforeCents: 20000, cityTaxCents: 0, now: 1, paymentIntent: "pi_x" });
  assert.equal(first.booking.paymentMethod, "carta");
  const later = applyChatPayment({ id: "b", paid: 100 }, { sessionId: "cs_1", cents: 5000, kind: "saldo", balanceBeforeCents: 20000, cityTaxCents: 0, now: 1, paymentIntent: "pi_x" });
  assert.equal(later.booking.paymentMethod, undefined);
});

// ───────────────────────── H1 #3: rimborso su un PI condiviso da piu' camere ─────────────────────────
test("reconcile: preventivo multi-camera — il rimborso della camera B annullata scala B, non la camera A", () => {
  const A = { id: "A", status: "confirmed", paid: 100, stripeExtraPayments: [{ pi: "pi_q", amount: 100 }] };
  const B = { id: "B", status: "cancelled", paid: 80, stripeExtraPayments: [{ pi: "pi_q", amount: 80 }] };
  const p = planRefundOnBookings([A, B], "pi_q", { amount: 18000, amountRefunded: 8000 }, false, 1);
  assert.equal(p.found, true); assert.equal(p.ambiguous, undefined);
  assert.deepEqual(p.changes.map((c) => c.idx), [1]);
  assert.equal(p.changes[0].next.paid, 0); assert.deepEqual(p.changes[0].next.stripeExtraPayments, [{ pi: "pi_q", amount: 0 }]);
  // evento ripetuto: nulla da fare (il cumulato e' annotato sulla camera B)
  const again = planRefundOnBookings([A, p.changes[0].next], "pi_q", { amount: 18000, amountRefunded: 8000 }, false, 2);
  assert.deepEqual(again.changes, []);
});

test("reconcile: rimborso parziale con quota uguale a una sola camera = quella camera, anche se non annullata; un secondo rimborso si somma", () => {
  const A = { id: "A", status: "confirmed", paid: 100, stripeExtraPayments: [{ pi: "pi_q", amount: 100 }] };
  const B = { id: "B", status: "confirmed", paid: 80, stripeExtraPayments: [{ pi: "pi_q", amount: 80 }] };
  const p = planRefundOnBookings([A, B], "pi_q", { amount: 18000, amountRefunded: 8000 }, false, 1);
  assert.deepEqual(p.changes.map((c) => c.idx), [1]);
  assert.equal(p.changes[0].next.paid, 0);
  // poi la camera A viene rimborsata di 100: il cumulato del PI e' 180, il "nuovo" e' 100 = quota di A
  const p2 = planRefundOnBookings([A, p.changes[0].next], "pi_q", { amount: 18000, amountRefunded: 18000 }, false, 2);
  assert.deepEqual(p2.changes.map((c) => c.idx), [0]);
  assert.equal(p2.changes[0].next.paid, 0);
});

test("reconcile: ambiguo (due camere con la stessa quota, nessuna annullata) = nessun importo toccato, solo una nota (una volta)", () => {
  const mk = (id: string) => ({ id, status: "confirmed", paid: 100, stripeExtraPayments: [{ pi: "pi_q", amount: 100 }] });
  const p = planRefundOnBookings([mk("A"), mk("B")], "pi_q", { amount: 20000, amountRefunded: 10000 }, false, 1);
  assert.equal(p.ambiguous, true);
  assert.deepEqual(p.changes.map((c) => c.next.paid), [100, 100]);
  assert.match(String(p.changes[0].next.note), /da riconciliare a mano/);
  const p2 = planRefundOnBookings(p.changes.map((c) => c.next), "pi_q", { amount: 20000, amountRefunded: 10000 }, false, 2);
  assert.deepEqual(p2.changes, [], "la nota non si ripete");
});

test("reconcile: una sola camera con il PI = comportamento invariato", () => {
  const p = planRefundOnBookings([{ id: "A", paid: 200, stripePaymentIntent: "pi_1" }, { id: "B", paid: 50 }], "pi_1", { amount: 20000, amountRefunded: 5000 }, false, 1);
  assert.deepEqual(p.changes.map((c) => c.idx), [0]); assert.equal(p.changes[0].next.paid, 150);
  assert.equal(planRefundOnBookings([{ id: "B" }], "pi_1", { amount: 1, amountRefunded: 1 }, false, 1).found, false);
});
