import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlatformFee, proratedFeeRefundCents } from "../src/lib/payments/fee.ts";

const withVat = { hasVatNumber: true };

test("fee standard 1,5% + IVA 22% su 100,00 €", () => {
  const r = computePlatformFee(10000, "direct", withVat);
  assert.equal(r.applies, true);
  assert.equal(r.baseCents, 150);          // 1,5% di 10000
  assert.equal(r.vatCents, 33);            // 183 - 150
  assert.equal(r.totalCents, 183);         // round(150 * 1,22) = 183
  assert.equal(r.baseCents + r.vatCents, r.totalCents);
});

test("nessuna fee se source non è 'direct'", () => {
  assert.equal(computePlatformFee(10000, "ota", withVat).applies, false);
  assert.equal(computePlatformFee(10000, "manual", withVat).totalCents, 0);
});

test("nessuna fee senza P.IVA (default OFF)", () => {
  const r = computePlatformFee(10000, "direct", { hasVatNumber: false });
  assert.equal(r.applies, false);
  assert.equal(r.totalCents, 0);
});

test("nessuna fee se disabilitata per il tenant", () => {
  const r = computePlatformFee(10000, "direct", { hasVatNumber: true, enabled: false });
  assert.equal(r.applies, false);
});

test("importo piccolo: arrotondamento coerente (base+IVA=totale)", () => {
  const r = computePlatformFee(199, "direct", withVat); // 1,99 €
  assert.equal(r.baseCents, 3);            // round(199*0.015)=round(2.985)=3
  assert.equal(r.totalCents, 4);           // round(2.985*1.22)=round(3.6417)=4
  assert.equal(r.vatCents, 1);
  assert.equal(r.baseCents + r.vatCents, r.totalCents);
});

test("importo zero → nessuna fee", () => {
  assert.equal(computePlatformFee(0, "direct", withVat).applies, false);
});

test("bps personalizzato per tenant (200 = 2%)", () => {
  const r = computePlatformFee(10000, "direct", { hasVatNumber: true, bps: 200 });
  assert.equal(r.baseCents, 200);
  assert.equal(r.totalCents, 244);         // round(200*1,22)
});

test("rimborso proporzionale della fee", () => {
  const fee = computePlatformFee(10000, "direct", withVat); // total 183
  assert.equal(proratedFeeRefundCents(fee, 10000, 10000), 183); // rimborso totale
  assert.equal(proratedFeeRefundCents(fee, 10000, 5000), 92);   // metà: round(183*0.5)=92
  assert.equal(proratedFeeRefundCents(fee, 10000, 0), 0);
});
