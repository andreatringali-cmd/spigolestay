import test from "node:test";
import assert from "node:assert/strict";
import { sdiPaymentCode } from "../src/lib/invoicing/payment-codes.ts";

test("metodo di pagamento → codice SdI", () => {
  assert.equal(sdiPaymentCode("Bonifico bancario"), "MP05");
  assert.equal(sdiPaymentCode("Carta"), "MP08");
  assert.equal(sdiPaymentCode("Contanti"), "MP01");
  assert.equal(sdiPaymentCode("Assegno"), "MP02");
  assert.equal(sdiPaymentCode("PayPal"), "MP08");
});

test("un codice già valido passa invariato; vuoto o sconosciuto ripiega sul bonifico", () => {
  assert.equal(sdiPaymentCode("MP12"), "MP12");
  assert.equal(sdiPaymentCode("mp08"), "MP08");
  assert.equal(sdiPaymentCode(""), "MP05");
  assert.equal(sdiPaymentCode(null), "MP05");
  assert.equal(sdiPaymentCode("boh"), "MP05");
  assert.equal(sdiPaymentCode("MP99"), "MP05"); // non è un codice valido
});
