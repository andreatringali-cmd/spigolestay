import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Correzioni QA 16/10 sulle prenotazioni: tassa con tutti gli ospiti, residuo senza tassa già incassata, ricavo per notte dopo un prolungamento, extra del check-in.
register("./helpers/alias-loader.mjs", import.meta.url);
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
} as Storage;
const { bookingGrandTotal, cityTaxOfBooking, revenueInRange, nightlyRevenue, sanitizeChosenExtras } = await import("../src/lib/booking.ts");
const { balanceDue, paymentStatus, totalDue } = await import("../src/lib/incassi.ts");
const { applyChatPayment } = await import("../src/lib/chat-pay-core.ts");

const siracusa = { cityTax: true, cityTaxMode: "percent", cityTaxPercent: 4, cityTaxCap: 5, cityTaxMaxNights: 7, cityTaxChildFreeUnder: 14 } as never;
const bk = (extra: Record<string, unknown> = {}) => ({ checkIn: "2026-10-10", checkOut: "2026-10-13", adults: 2, children: 0, total: 300, ...extra });

// ── tassa di soggiorno nel totale ospite ─────────────────────────────────────

test("totale ospite: la tassa divide per TUTTI gli ospiti (2 adulti + 2 bambini di 8 anni, 7 notti, 700 €)", () => {
  const b = bk({ checkOut: "2026-10-17", total: 700, children: 2, childAges: [8, 8] });
  assert.equal(cityTaxOfBooking(siracusa, b), 14);          // 100 €/notte ÷ 4 ospiti × 4% = 1 € × 2 paganti × 7 notti
  assert.equal(bookingGrandTotal(b, siracusa), 714);        // prima: 728 (divisore = 2 paganti)
});

test("totale ospite: un ragazzo sopra soglia paga e conta nel divisore", () => {
  const b = bk({ children: 1, childAges: [15] });
  assert.equal(bookingGrandTotal(b, siracusa), 312);        // 3 paganti, 3 ospiti: 100 ÷ 3 × 4% × 3 × 3 = 12
});

test("senza prezzo del soggiorno il totale resta 0 (nessun importo inventato)", () => {
  assert.equal(bookingGrandTotal(bk({ total: undefined }), siracusa), 0);
});

// ── residuo e stato pagamento ────────────────────────────────────────────────

test("tassa incassata a mano (cityTaxPaid): il residuo non la chiede una seconda volta", () => {
  const b = bk({ paid: 300, cityTaxPaid: true });
  assert.equal(totalDue(b, siracusa), 300);
  assert.equal(balanceDue(b, siracusa), 0);
  assert.equal(paymentStatus(b, siracusa), "saldato");
});

test("tassa NON incassata: il residuo la include come prima", () => {
  const b = bk({ paid: 300 });
  assert.equal(balanceDue(b, siracusa), 12);
  assert.equal(paymentStatus(b, siracusa), "acconto");
});

test("tassa pagata col link (cityTaxInPaid): quei soldi sono già dentro paid, il soggiorno resta da saldare", () => {
  const b = bk({ paid: 12, cityTaxPaid: true, cityTaxInPaid: true });
  assert.equal(balanceDue(b, siracusa), 300);
});

test("applyChatPayment: il pagamento col link 'tassa' segna anche cityTaxInPaid; il saldo che azzera il residuo con tassa pure", () => {
  const base = { id: "b1", paid: 0 };
  const tassa = applyChatPayment(base, { sessionId: "s1", cents: 1200, kind: "tassa", balanceBeforeCents: 31200, cityTaxCents: 1200, now: 1 });
  assert.equal(tassa.booking.cityTaxPaid, true);
  assert.equal(tassa.booking.cityTaxInPaid, true);
  const saldo = applyChatPayment(base, { sessionId: "s2", cents: 31200, kind: "saldo", balanceBeforeCents: 31200, cityTaxCents: 1200, now: 1 });
  assert.equal(saldo.booking.cityTaxPaid, true);
  assert.equal(saldo.booking.cityTaxInPaid, true);
  // Poi un extra da 20 €: il residuo deve essere 20 (332 − 312), non 8.
  const dopo = { ...bk({ paid: 312 }), ...saldo.booking, extras: [{ price: 20 }] };
  assert.equal(balanceDue(dopo as never, siracusa), 20);
});

test("applyChatPayment: saldo dopo tassa già incassata a mano NON segna cityTaxInPaid", () => {
  const base = { id: "b2", paid: 0, cityTaxPaid: true };
  const saldo = applyChatPayment(base, { sessionId: "s3", cents: 30000, kind: "saldo", balanceBeforeCents: 30000, cityTaxCents: 1200, now: 1 });
  assert.equal(saldo.booking.cityTaxPaid, true);
  assert.equal(saldo.booking.cityTaxInPaid, undefined);
});

// ── ricavo per notte dopo un prolungamento a mano ────────────────────────────

test("ricavo per notte: le notti aggiunte a mano si spartiscono il di più del totale", () => {
  // Booking da 2 notti (100 + 100), poi prolungata di 3 notti portando il totale a 500.
  const b = { checkIn: "2026-10-10", checkOut: "2026-10-15", total: 500, nightlyRates: { "2026-10-10": 100, "2026-10-11": 100 } };
  assert.equal(revenueInRange(b, "2026-10-01", "2026-11-01"), 500);
  assert.equal(nightlyRevenue(b, "2026-10-10"), 100);
  assert.equal(nightlyRevenue(b, "2026-10-12"), 100);       // (500 − 200) ÷ 3 notti senza tariffa
  assert.equal(revenueInRange(b, "2026-10-12", "2026-10-14"), 200);
});

test("ricavo per notte: tariffe complete invariate, notti senza tariffa e senza totale = 0", () => {
  const full = { checkIn: "2026-10-10", checkOut: "2026-10-12", total: 999, nightlyRates: { "2026-10-10": 80, "2026-10-11": 120 } };
  assert.equal(revenueInRange(full, "2026-10-10", "2026-10-12"), 200);
  const noTotal = { checkIn: "2026-10-10", checkOut: "2026-10-12", nightlyRates: { "2026-10-10": 80 } };
  assert.equal(revenueInRange(noTotal, "2026-10-10", "2026-10-12"), 80);
});

// ── extra del check-in: nome e prezzo dal catalogo del server ────────────────

const catalog = [
  { id: "col", name: "Colazione", price: 8, per: "person" as const },
  { id: "park", name: "Parcheggio", price: 10, per: "night" as const, maxQty: 2 },
  { id: "off", name: "Spento", price: 5, per: "stay" as const, active: false },
  { id: "gratis", name: "Culla", price: 0, per: "stay" as const },
];
const stay = { checkIn: "2026-10-10", checkOut: "2026-10-13", adults: 2 };

test("extra: il prezzo negativo o inventato dal client viene ignorato, vale quello del catalogo", () => {
  const r = sanitizeChosenExtras([{ name: "Colazione", price: -500 }], catalog, stay);
  assert.deepEqual(r, [{ name: "Colazione", price: 16, extraId: "col", qty: 1 }]);   // 8 € × 2 adulti
});

test("extra: quantità dal suffisso ×N o da qty, intera e tra 1 e 20, mai oltre maxQty", () => {
  assert.equal(sanitizeChosenExtras([{ name: "Colazione ×3", price: 1 }], catalog, stay)[0].price, 48);
  assert.equal(sanitizeChosenExtras([{ extraId: "park", qty: 9 }], catalog, stay)[0].qty, 2);
  assert.equal(sanitizeChosenExtras([{ extraId: "col", qty: 999 }], catalog, stay)[0].qty, 20);
  assert.equal(sanitizeChosenExtras([{ extraId: "col", qty: 0 }], catalog, stay).length, 0);
  assert.equal(sanitizeChosenExtras([{ extraId: "col", qty: -3 }], catalog, stay).length, 0);
  assert.equal(sanitizeChosenExtras([{ extraId: "col", qty: "x" }], catalog, stay).length, 0);
});

test("extra: sconosciuti, spenti e doppioni vengono scartati; rispetto a quelli già sulla prenotazione non si duplica", () => {
  const r = sanitizeChosenExtras([{ name: "Sconto", price: -300 }, { extraId: "off" }, { name: "Colazione" }, { name: "Colazione ×2" }, { extraId: "park" }], catalog, stay, [{ name: "Parcheggio ×1", extraId: "park" }]);
  assert.deepEqual(r.map((x) => x.extraId), ["col"]);
  assert.ok(r.every((x) => x.price >= 0));
});

test("extra: un servizio gratuito resta a 0 e input non validi non rompono nulla", () => {
  assert.equal(sanitizeChosenExtras([{ name: "Culla" }], catalog, stay)[0].price, 0);
  assert.deepEqual(sanitizeChosenExtras(null, catalog, stay), []);
  assert.deepEqual(sanitizeChosenExtras([null, 5, "x", {}], catalog, stay), []);
  assert.deepEqual(sanitizeChosenExtras([{ name: "Colazione" }], undefined, stay), []);
});
