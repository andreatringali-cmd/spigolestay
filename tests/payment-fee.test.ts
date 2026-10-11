import test from "node:test";
import assert from "node:assert/strict";
import { parsePaymentCharge } from "../src/lib/payment-fee.ts";

test("legge il Payment charge dalle note di Booking, in euro con i centesimi", () => {
  assert.equal(parsePaymentCharge("** THIS RESERVATION HAS BEEN PRE-PAID **\nBOOKING NOTE : Payment charge is EUR 13.9968\nMeal Plan"), 14);
  assert.equal(parsePaymentCharge("Payment charge is EUR 4,5"), 4.5);
  assert.equal(parsePaymentCharge("payment charge is € 7.25"), 7.25);
});

test("senza Payment charge o con valori non validi: nessun costo", () => {
  assert.equal(parsePaymentCharge(""), undefined);
  assert.equal(parsePaymentCharge(undefined), undefined);
  assert.equal(parsePaymentCharge("Payment Collect: OTA collect"), undefined);
  assert.equal(parsePaymentCharge("Payment charge is EUR 0"), undefined);
});
