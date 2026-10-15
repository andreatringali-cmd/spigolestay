import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { computeAuto, computeForecast, groupBookingRows, REST_IN_PREFIX } = await import("../src/lib/cassa.ts");
const { onlineIncasso, onlinePaymentPatch, isOnlineDirect } = await import("../src/lib/online-pay.ts");
const { effectivePayMethod, cassaContoFor, invoicePayMethodLabel, ONLINE_PAY_LABEL } = await import("../src/lib/pay-method.ts");
const { sdiPaymentCode } = await import("../src/lib/invoicing/payment-codes.ts");
const { applyChatPayment } = await import("../src/lib/chat-pay-core.ts");

const st = { id: "s1", name: "Casa", groupName: "G" };
const guests = [{ id: "g", fullName: "Scholz Franz Markus" }] as never;
const CONTI = ["contanti", "banca", "carta"];
const run = (b: object) => computeAuto([b as never], guests, () => st as never, "all", "banca", {}, CONTI);
// Come la prenotazione della segnalazione: diretta dal sito, 21-23 ott 2026, 139 euro pagati online con Stripe il giorno della prenotazione.
const base = { id: "b1", structureId: "s1", roomTypeId: "r", unitId: null, guestId: "g", channel: "direct", status: "confirmed", checkIn: "2026-10-21", checkOut: "2026-10-23", adults: 2, children: 0, total: 139 };

test("diretta pagata online: l'incasso e' del giorno del pagamento (paidAt), non dell'arrivo, un solo movimento sul conto Carta", () => {
  const out = run({ ...base, paid: 139, paidOnline: 139, paidAt: "2026-10-10", stripePaymentIntent: "pi_1" }).filter((m) => m.kind === "in");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "auto-in-b1");
  assert.equal(out[0].date, "2026-10-10");
  assert.equal(out[0].amount, 139);
  assert.equal(out[0].conto, "carta");
  assert.equal(out[0].ref, "b1");
});

test("diretta pagata in parte online e resto incassato dopo: due movimenti, il resto alla data di arrivo e in contanti", () => {
  const out = run({ ...base, paid: 139, paidOnline: 50, paidAt: "2026-10-10", stripePaymentIntent: "pi_1" }).filter((m) => m.kind === "in");
  assert.equal(out.length, 2);
  const online = out.find((m) => m.id === "auto-in-b1")!;
  const rest = out.find((m) => m.id === `${REST_IN_PREFIX}b1`)!;
  assert.deepEqual([online.date, online.amount, online.conto], ["2026-10-10", 50, "carta"]);
  assert.deepEqual([rest.date, rest.amount, rest.conto, rest.ref], ["2026-10-21", 89, "contanti", "b1"]);
  assert.ok(/^(auto-in|auto-comm|fc-in)-/.test(rest.id)); // riconosciuto dal filtro Prenotazioni e da bkOf della pagina Cassa
  assert.equal(out.reduce((s, m) => s + m.amount, 0), 139);
});

test("solo acconto online: il saldo ancora da incassare resta previsto alla data di arrivo, sul conto storico (contanti)", () => {
  const b = { ...base, checkIn: "2099-01-10", checkOut: "2099-01-12", total: 200, paid: 60, paidOnline: 60, paidAt: "2098-12-01", stripePaymentIntent: "pi_1" };
  const fc = computeForecast([b as never], guests, () => st as never, [], "all", "2098-12-15", "2099-12-31", "banca", {}, CONTI);
  const f = fc.find((m) => m.id === "fc-in-b1")!;
  assert.deepEqual([f.date, f.amount, f.conto], ["2099-01-10", 140, "contanti"]);
  assert.equal(run(b).find((m) => m.id === "auto-in-b1")?.date, "2098-12-01");
});

test("prenotazione vecchia senza paidAt/paidOnline: ripiego = giorno della prenotazione (bookedOn), altrimenti updatedAt (Roma), mai oltre l'arrivo; tutto il pagato e' online", () => {
  const old = { ...base, paid: 139, stripePaymentIntent: "pi_old" };
  assert.equal(run({ ...old, bookedOn: "2026-10-12", updatedAt: Date.parse("2026-10-14T10:00:00Z") }).find((m) => m.kind === "in")?.date, "2026-10-12");
  // senza bookedOn: updatedAt; 2026-10-14 22:30 UTC = 15 ottobre 00:30 a Roma
  assert.equal(run({ ...old, updatedAt: Date.parse("2026-10-14T22:30:00Z") }).find((m) => m.kind === "in")?.date, "2026-10-15");
  // modificata dopo l'arrivo: non oltre il check-in
  assert.equal(run({ ...old, updatedAt: Date.parse("2026-11-30T10:00:00Z") }).find((m) => m.kind === "in")?.date, "2026-10-21");
  // nessun dato utile: data di arrivo (come prima)
  assert.equal(run(old).find((m) => m.kind === "in")?.date, "2026-10-21");
  const info = onlineIncasso({ ...old, bookedOn: "2026-10-12" });
  assert.deepEqual([info?.amount, info?.rest, info?.approx], [139, 0, true]);
  assert.equal(onlineIncasso({ ...old, paidAt: "2026-10-10", paidOnline: 139 })?.approx, false);
});

test("OTA e dirette senza pagamento online: nessun cambio (data del canale, un solo movimento)", () => {
  const ota = run({ ...base, channel: "booking", paid: 139, bookedOn: "2026-10-01", paidAt: "2026-10-01", paidOnline: 139, stripePaymentIntent: "pi_x" }).filter((m) => m.kind === "in");
  assert.equal(ota.length, 1);
  assert.equal(ota[0].date, "2026-10-21");
  const cash = run({ ...base, paid: 139, bookedOn: "2026-10-01" }).filter((m) => m.kind === "in");
  assert.equal(cash.length, 1);
  assert.deepEqual([cash[0].id, cash[0].date, cash[0].conto], ["auto-in-b1", "2026-10-21", "contanti"]);
  assert.equal(isOnlineDirect({ channel: "direct", paid: 10 }), false);
  assert.equal(isOnlineDirect({ channel: "booking", stripePaymentIntent: "pi" }), false);
});

test("prenotazione annullata o non incassata: nessun movimento", () => {
  assert.equal(run({ ...base, status: "cancelled", paid: 139, paidAt: "2026-10-10", paidOnline: 139, stripePaymentIntent: "pi" }).length, 0);
  assert.equal(run({ ...base, paid: 0, stripePaymentIntent: "pi" }).filter((m) => m.kind === "in").length, 0);
});

test("metodo di incasso: pagamento online Stripe senza scelta = Carta automatica (modificabile); la scelta manuale vince", () => {
  assert.deepEqual(effectivePayMethod({ channel: "direct", stripePaymentIntent: "pi_1" }), { method: "carta", auto: false, online: true });
  assert.equal(ONLINE_PAY_LABEL, "Carta · pagamento online (automatico)");
  assert.deepEqual(effectivePayMethod({ channel: "direct", stripePaymentIntent: "pi_1", paymentMethod: "bonifico" }), { method: "bonifico", auto: false });
  assert.deepEqual(effectivePayMethod({ channel: "direct", stripePaymentIntent: "pi_1", paymentMethod: "ota" }), { method: "carta", auto: false, online: true }); // "ota" su una diretta non vale
  assert.deepEqual(effectivePayMethod({ channel: "direct" }), { method: undefined, auto: false }); // senza Stripe: come prima
  assert.deepEqual(effectivePayMethod({ channel: "booking", stripePaymentIntent: "pi_1" }), { method: undefined, auto: false }); // OTA: invariato
  assert.deepEqual(effectivePayMethod({ channel: "booking", otaInfo: { paymentCollect: "ota" }, stripePaymentIntent: "pi_1" }), { method: "ota", auto: true });
});

test("conto di Cassa e fattura seguono la carta automatica", () => {
  assert.equal(cassaContoFor({ channel: "direct", stripePaymentIntent: "pi" }, "banca", CONTI), "carta");
  assert.equal(cassaContoFor({ channel: "direct", stripePaymentIntent: "pi" }, "banca", ["contanti", "banca"]), "banca"); // conto Carta eliminato
  assert.equal(cassaContoFor({ channel: "direct", stripePaymentIntent: "pi", paymentMethod: "contanti" }, "banca", CONTI), "contanti");
  assert.equal(invoicePayMethodLabel({ channel: "direct", stripePaymentIntent: "pi" }), "Carta");
  assert.equal(sdiPaymentCode(invoicePayMethodLabel({ channel: "direct", stripePaymentIntent: "pi" })), "MP08");
  assert.equal(invoicePayMethodLabel({ channel: "direct" }), undefined);
});

test("con metodo scelto a mano (bonifico) la parte online va su quel conto, il resto segue la stessa scelta", () => {
  const out = run({ ...base, paid: 139, paidOnline: 50, paidAt: "2026-10-10", stripePaymentIntent: "pi", paymentMethod: "bonifico" }).filter((m) => m.kind === "in");
  assert.deepEqual(out.map((m) => m.conto), ["banca", "banca"]);
});

test("voce in elenco: il resto non si fonde con la commissione e non duplica la voce prenotazione", () => {
  const out = run({ ...base, paid: 139, paidOnline: 50, paidAt: "2026-10-10", stripePaymentIntent: "pi_1" });
  const rows = groupBookingRows(out);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.type === "mov"));
});

test("pagamento online successivo (saldo): paidOnline si somma, paidAt = giorno di quel pagamento, idempotente sulla sessione", () => {
  const now = Date.parse("2026-10-20T08:00:00Z");
  const b0 = { id: "b1", paid: 50, paidOnline: 50, paidAt: "2026-10-10", stripePaymentIntent: "pi_1", paidSessions: [] };
  const r = applyChatPayment(b0, { sessionId: "cs_1", cents: 8900, kind: "saldo", balanceBeforeCents: 8900, now });
  assert.equal(r.booking.paid, 139);
  assert.equal(r.booking.paidOnline, 139);
  assert.equal(r.booking.paidAt, "2026-10-20");
  const again = applyChatPayment(r.booking, { sessionId: "cs_1", cents: 8900, kind: "saldo", balanceBeforeCents: 0, now: now + 1000 });
  assert.equal(again.applied, false);
  assert.equal(again.booking.paidOnline, 139);
  // prenotazione Stripe vecchia senza paidOnline: la base e' il gia' incassato (coerente col ripiego)
  assert.deepEqual(onlinePaymentPatch({ stripePaymentIntent: "pi", paid: 50 }, 89, now), { paidOnline: 139, paidAt: "2026-10-20" });
  // diretta senza Stripe che paga col link: parte da zero
  assert.deepEqual(onlinePaymentPatch({ channel: "direct", paid: 50 }, 89, now), { paidOnline: 89, paidAt: "2026-10-20" });
});
