import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// booking.ts importa "./dates", "./types"... senza estensione e channelOverrides legge localStorage:
// qui si simula (window + localStorage) e si risolvono gli import con l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(), key: () => null, length: 0,
} as Storage;

const B = await import("../src/lib/booking.ts");
const { setCommissionEstimates } = await import("../src/lib/commission-estimate.ts");
const { balanceDue, paymentStatus, amountPaid } = await import("../src/lib/incassi.ts");

const COMM_KEY = "spigolestay:canali:commission";
const reset = () => { store.clear(); setCommissionEstimates({}); };
const base = { channel: "booking" as const, total: 100, structureId: "S" };

test("defaultCommissionInfo: standard del canale se non c'e' nient'altro", () => {
  reset();
  assert.deepEqual(B.defaultCommissionInfo("booking", "S"), { pct: 15, source: "standard" });
  assert.deepEqual(B.defaultCommissionInfo("expedia"), { pct: 18, source: "standard" });
  assert.deepEqual(B.defaultCommissionInfo("direct"), { pct: 0, source: "standard" });
});

test("defaultCommissionInfo: la stima batte lo standard, la scelta manuale batte la stima", () => {
  reset();
  setCommissionEstimates({ "booking@S": 12.5 });
  assert.deepEqual(B.defaultCommissionInfo("booking", "S"), { pct: 12.5, source: "stima" });
  assert.deepEqual(B.defaultCommissionInfo("booking", "T"), { pct: 15, source: "standard" }); // altra struttura: nessuna stima
  store.set(COMM_KEY, JSON.stringify({ booking: 10, "booking@S": 8 }));
  assert.deepEqual(B.defaultCommissionInfo("booking", "S"), { pct: 8, source: "manuale" }); // voce della struttura
  assert.deepEqual(B.defaultCommissionInfo("booking", "T"), { pct: 10, source: "manuale" }); // voce del canale
  reset();
});

test("commissionBaseOf / commissionOf: percentuale standard, ai centesimi", () => {
  reset();
  assert.equal(B.commissionBaseOf(base), 15);
  assert.equal(B.commissionOf(base), 15);
  assert.equal(B.commissionBaseOf({ ...base, total: 19.99, commissionPct: 12.5 }), 2.5); // 2,49875 -> 2,50
  assert.equal(B.commissionBaseOf({ ...base, total: 0 }), 0);
  assert.equal(B.commissionBaseOf({ ...base, channel: "direct" }), 0);
});

test("commissionBaseOf: percentuale propria prima della stima/manuale, anche se 0", () => {
  reset();
  setCommissionEstimates({ "booking@S": 12.5 });
  store.set(COMM_KEY, JSON.stringify({ booking: 10 }));
  assert.equal(B.commissionBaseOf({ ...base, commissionPct: 20 }), 20);
  assert.equal(B.commissionBaseOf({ ...base, commissionPct: 0 }), 0);
  assert.equal(B.commissionBaseOf(base), 10); // senza % propria: manuale
  reset();
  setCommissionEstimates({ "booking@S": 12.5 });
  assert.equal(B.commissionBaseOf(base), 12.5); // senza manuale: stima
  reset();
});

test("cifra reale: ha sempre la priorita' (anche 0) sulla percentuale", () => {
  reset();
  assert.equal(B.commissionBaseOf({ ...base, commissionAmount: 13.37, commissionPct: 50 }), 13.37);
  assert.equal(B.commissionOf({ ...base, commissionAmount: 13.37 }), 13.37);
  assert.equal(B.commissionBaseOf({ ...base, commissionAmount: 0, commissionPct: 50 }), 0);
});

test("paymentFeeOf: solo valori positivi; commissionOf = intermediazione + costo d'incasso", () => {
  reset();
  assert.equal(B.paymentFeeOf({ ...base, paymentFee: 1.5 }), 1.5);
  assert.equal(B.paymentFeeOf({ ...base, paymentFee: 0 }), 0);
  assert.equal(B.paymentFeeOf({ ...base, paymentFee: -3 }), 0);
  assert.equal(B.paymentFeeOf({ ...base, paymentFee: null }), 0);
  assert.equal(B.paymentFeeOf(base), 0);
  assert.equal(B.commissionOf({ ...base, commissionAmount: 13.37, paymentFee: 1.5 }), 14.87);
  assert.equal(B.commissionBaseOf({ ...base, commissionAmount: 13.37, paymentFee: 1.5 }), 13.37); // base senza costo d'incasso
  assert.equal(B.commissionOf({ ...base, paymentFee: 0.1 + 0.2 }), 15.3); // niente deriva decimale (15 + 0.30000000000000004)
});

test("commissionPctOf: da cifra reale + costo d'incasso se c'e' il totale, altrimenti % propria/predefinita", () => {
  reset();
  assert.equal(B.commissionPctOf({ ...base, total: 200, commissionAmount: 30, paymentFee: 2 }), 16);
  assert.equal(B.commissionPctOf({ ...base, commissionAmount: 13.37, paymentFee: 1.5 }), 14.9);
  assert.equal(B.commissionPctOf({ ...base, total: 0, commissionAmount: 30, commissionPct: 7 }), 7);
  assert.equal(B.commissionPctOf(base), 15);
});

test("lordoOf: soggiorno + pulizia + extra, senza tassa di soggiorno; 0 se manca il prezzo soggiorno", () => {
  reset();
  assert.equal(B.lordoOf({ ...base, cleaningFee: 20, extras: [{ price: 5.5 }, { price: 4.5 }, {}] }), 130);
  assert.equal(B.lordoOf({ ...base, total: 0, cleaningFee: 20 }), 0);
  assert.equal(B.lordoOf(base), 100);
});

test("nettoOf: lordo - commissioni, arrotondato ai centesimi", () => {
  reset();
  assert.equal(B.nettoOf({ ...base, cleaningFee: 20, extras: [{ price: 10 }] }), 115); // 130 - 15
  // 130,10 - 10,01 = 120,08999999... in virgola mobile -> 120,09
  assert.equal(B.nettoOf({ ...base, total: 100.1, cleaningFee: 30, commissionPct: 10 }), 120.09);
  assert.equal(B.nettoOf({ ...base, total: 0, cleaningFee: 30 }), 0);
  assert.equal(B.nettoOf({ ...base, commissionAmount: 13.37, paymentFee: 1.5 }), 85.13);
});

test("commissionShareOf: commissioni / lordo in % con un decimale", () => {
  reset();
  assert.equal(B.commissionShareOf({ ...base, cleaningFee: 20, extras: [{ price: 10 }] }), 11.5); // 15 / 130
  assert.equal(B.commissionShareOf({ ...base, total: 200, commissionAmount: 30, paymentFee: 2 }), 16);
  assert.equal(B.commissionShareOf({ ...base, total: 0 }), 0);
  assert.equal(B.commissionShareOf({ ...base, channel: "direct" }), 0);
});

test("incassi: residuo e stato senza deriva decimale", () => {
  reset();
  // 100,1 + 0,1 + 0,2 in virgola mobile non e' esattamente 100,4
  const bk = { checkIn: "2026-06-01", checkOut: "2026-06-02", total: 100.1, extras: [{ price: 0.1 }, { price: 0.2 }] };
  assert.equal(balanceDue({ ...bk, paid: 100.2 }, undefined), 0.2);
  assert.equal(paymentStatus({ ...bk, paid: 0.1 + 0.2 + 100.1 }, undefined), "saldato");
  assert.equal(paymentStatus({ ...bk, paid: 50 }, undefined), "acconto");
  assert.equal(paymentStatus({ ...bk, paid: 0 }, undefined), "da incassare");
  assert.equal(amountPaid({ paid: 0.1 + 0.2 }), 0.3);
  assert.equal(amountPaid({ paid: -5 }), 0);
});
