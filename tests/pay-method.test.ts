import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { effectivePayMethod, otaCollectsPayment, invoicePayMethodLabel, cassaContoFor, otaPayDetail } = await import("../src/lib/pay-method.ts");
const { sdiPaymentCode } = await import("../src/lib/invoicing/payment-codes.ts");
const { computeAuto, computeForecast } = await import("../src/lib/cassa.ts");

test("OTA che incassa (payment_collect = ota): Incasso OTA automatico, anche se era salvato un altro metodo", () => {
  const e = effectivePayMethod({ channel: "booking", otaInfo: { paymentCollect: "ota" }, paymentMethod: "contanti" });
  assert.deepEqual(e, { method: "ota", auto: true });
});

test("OTA che NON incassa (payment_collect = property): scelta manuale, mai automatico", () => {
  assert.deepEqual(effectivePayMethod({ channel: "booking", otaInfo: { paymentCollect: "property" } }), { method: undefined, auto: false });
  assert.deepEqual(effectivePayMethod({ channel: "booking", otaInfo: { paymentCollect: "property" }, paymentMethod: "carta", otaCard: { present: true } }), { method: "carta", auto: false });
});

test("indizi: Expedia netto, carta virtuale, Payment charge di Booking, Airbnb", () => {
  assert.ok(otaCollectsPayment({ channel: "expedia", extId: "channex:abc" })); // pagamento netto Expedia
  assert.ok(otaCollectsPayment({ channel: "other", otaCard: { present: true } }));
  assert.ok(otaCollectsPayment({ channel: "booking", paymentFee: 3.2 }));
  assert.ok(otaCollectsPayment({ channel: "airbnb" }));
  assert.ok(!otaCollectsPayment({ channel: "booking" })); // nessun indizio: lo sceglie il gestore
  assert.ok(!otaCollectsPayment({ channel: "booking", paymentFee: 0 }));
});

test("prenotazione diretta o blocco: mai Incasso OTA, nemmeno se salvato per errore", () => {
  assert.deepEqual(effectivePayMethod({ channel: "direct", paymentMethod: "ota", otaInfo: { paymentCollect: "ota" } }), { method: undefined, auto: false });
  assert.deepEqual(effectivePayMethod({ channel: "direct", paymentMethod: "bonifico" }), { method: "bonifico", auto: false });
  assert.deepEqual(effectivePayMethod({ channel: "direct" }), { method: undefined, auto: false });
});

test("etichetta fattura: il codice SdI e' coerente con payment-codes", () => {
  assert.equal(sdiPaymentCode(invoicePayMethodLabel({ channel: "direct", paymentMethod: "contanti" })), "MP01");
  assert.equal(sdiPaymentCode(invoicePayMethodLabel({ channel: "direct", paymentMethod: "carta" })), "MP08");
  assert.equal(sdiPaymentCode(invoicePayMethodLabel({ channel: "direct", paymentMethod: "bonifico" })), "MP05");
  assert.equal(sdiPaymentCode(invoicePayMethodLabel({ channel: "booking", otaInfo: { paymentCollect: "ota", paymentType: "bank_transfer" } })), "MP05");
  assert.equal(sdiPaymentCode(invoicePayMethodLabel({ channel: "booking", otaCard: { present: true } })), "MP08"); // carta virtuale
  assert.equal(invoicePayMethodLabel({ channel: "direct" }), undefined); // nessuna indicazione: la fattura usa il suo predefinito
  assert.equal(otaPayDetail({ channel: "booking", otaCard: { present: true } }), "carta virtuale");
});

test("conto di Cassa: senza metodo resta il comportamento storico; con metodo segue la scelta", () => {
  assert.equal(cassaContoFor({ channel: "direct" }, "banca"), "contanti");
  assert.equal(cassaContoFor({ channel: "booking" }, "banca"), "banca");
  assert.equal(cassaContoFor({ channel: "direct", paymentMethod: "bonifico" }, "banca"), "banca");
  assert.equal(cassaContoFor({ channel: "direct", paymentMethod: "carta" }, "banca", ["contanti", "banca", "carta"]), "carta");
  assert.equal(cassaContoFor({ channel: "direct", paymentMethod: "carta" }, "banca", ["contanti", "banca"]), "banca"); // conto Carta eliminato
  assert.equal(cassaContoFor({ channel: "booking", paymentMethod: "contanti", otaInfo: { paymentCollect: "property" } }, "banca"), "contanti");
  assert.equal(cassaContoFor({ channel: "booking", otaInfo: { paymentCollect: "ota" }, paymentMethod: "contanti" }, "banca"), "banca");
});

const st = { id: "s1", name: "Casa", groupName: "G" };
const base = { id: "b1", structureId: "s1", roomTypeId: "r", unitId: null, guestId: "g", status: "confirmed", checkIn: "2026-11-10", checkOut: "2026-11-12", adults: 2, children: 0, total: 200 };

test("Cassa: l'incasso automatico va sul conto del metodo scelto", () => {
  const b = { ...base, channel: "direct", paid: 100, paymentMethod: "carta" } as never;
  const out = computeAuto([b], [], () => st as never, "all", "banca", {}, ["contanti", "banca", "carta"]);
  const inc = out.find((m) => m.kind === "in");
  assert.equal(inc?.conto, "carta");
  assert.equal(inc?.amount, 100);
  const noMethod = computeAuto([{ ...base, channel: "direct", paid: 100 } as never], [], () => st as never, "all", "banca", {}, ["contanti", "banca"]);
  assert.equal(noMethod.find((m) => m.kind === "in")?.conto, "contanti");
});

test("Cassa: il dovuto previsto include gli extra", () => {
  const b = { ...base, channel: "direct", paid: 0, cleaningFee: 20, extras: [{ name: "Letto aggiuntivo ×2", price: 40, extraId: "letto-aggiuntivo", qty: 2 }], checkIn: "2099-01-10", checkOut: "2099-01-12" } as never;
  const out = computeForecast([b], [], () => st as never, [], "all", "2098-12-01", "2099-12-31", "banca", {}, ["contanti", "banca"]);
  assert.equal(out.find((m) => m.id === "fc-in-b1")?.amount, 260);
});
