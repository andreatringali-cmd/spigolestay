import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { commissionOf, nettoOf, otaAdjustmentOf, commissionShareOf } = await import("../src/lib/booking.ts");

const hb = { channel: "hotelbeds" as const, total: 833, commissionAmount: 149.9, otaCard: { present: true, balance: 648.9, currency: "EUR" } };

test("carta virtuale più bassa del netto atteso: lo scarto (sconto Agency Booster) conta come trattenuta e il netto torna con la carta", () => {
  assert.equal(otaAdjustmentOf(hb), 34.2);
  assert.equal(commissionOf(hb), 184.1);
  assert.equal(nettoOf(hb), 648.9);
  assert.equal(commissionShareOf(hb), 22.1);
});

test("nessuna correzione senza carta, con carta già addebitata, in altra valuta o con cifra uguale/maggiore", () => {
  assert.equal(otaAdjustmentOf({ ...hb, otaCard: undefined }), 0);
  assert.equal(otaAdjustmentOf({ ...hb, otaCard: { ...hb.otaCard, charged: true } }), 0);
  assert.equal(otaAdjustmentOf({ ...hb, otaCard: { ...hb.otaCard, currency: "USD" } }), 0);
  assert.equal(otaAdjustmentOf({ ...hb, otaCard: { ...hb.otaCard, balance: 683.1 } }), 0); // = netto atteso
  assert.equal(otaAdjustmentOf({ ...hb, otaCard: { ...hb.otaCard, balance: 900 } }), 0);   // carta più alta (Booking: lordo)
  assert.equal(otaAdjustmentOf({ ...hb, otaCard: { ...hb.otaCard, balance: 683.0 } }), 0); // scarto sotto 50 centesimi
});

test("carta che copre solo una parte (scarto oltre metà del lordo): non si corregge", () => {
  assert.equal(otaAdjustmentOf({ ...hb, otaCard: { ...hb.otaCard, balance: 100 } }), 0);
});

test("pagamento netto (Expedia da Channex): nessuna correzione", () => {
  assert.equal(otaAdjustmentOf({ channel: "expedia", total: 500, netTotal: true, otaCard: { present: true, balance: 300, currency: "EUR" } }), 0);
});
