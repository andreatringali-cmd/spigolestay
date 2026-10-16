import test from "node:test";
import assert from "node:assert/strict";
import { computeCommissionEstimates, MIN_ESTIMATE_SAMPLES } from "../src/lib/commission-estimate.ts";

const bk = (n: number, extra: Record<string, unknown> = {}) => Array.from({ length: n }, () => ({ channel: "booking", structureId: "S", status: "confirmed", total: 100, commissionAmount: 20, checkIn: "2026-06-01", ...extra }));

test("media pesata sulle prenotazioni con cifra reale, per canale e struttura", () => {
  const r = computeCommissionEstimates([...bk(3), ...bk(3, { total: 300, commissionAmount: 90 })], "2026-10-11");
  assert.equal(r["booking@S"], 27.5); // (3*20 + 3*90) / (3*100 + 3*300)
});

test("poche prenotazioni, cancellate, vecchie, dirette o senza cifra non fanno stima", () => {
  assert.deepEqual(computeCommissionEstimates(bk(MIN_ESTIMATE_SAMPLES - 1), "2026-10-11"), {});
  assert.deepEqual(computeCommissionEstimates(bk(10, { status: "cancelled" }), "2026-10-11"), {});
  assert.deepEqual(computeCommissionEstimates(bk(10, { checkIn: "2025-01-01" }), "2026-10-11"), {}); // oltre 12 mesi
  assert.deepEqual(computeCommissionEstimates(bk(10, { channel: "direct" }), "2026-10-11"), {});
  assert.deepEqual(computeCommissionEstimates(bk(10, { commissionAmount: null }), "2026-10-11"), {});
});

test("strutture e canali separati", () => {
  const r = computeCommissionEstimates([...bk(5), ...bk(5, { structureId: "T", commissionAmount: 10 }), ...bk(5, { channel: "expedia", commissionAmount: 30 })], "2026-10-11");
  assert.equal(r["booking@S"], 20); assert.equal(r["booking@T"], 10); assert.equal(r["expedia@S"], 30);
});

test("conta di più il periodo recente: se negli ultimi 90 giorni ci sono abbastanza dati, la vecchia media non pesa", () => {
  const vecchie = bk(6, { commissionAmount: 12, checkIn: "2026-02-01" }); // 12%
  const recenti = bk(5, { commissionAmount: 24.5, checkIn: "2026-09-20" }); // 24,5%
  const r = computeCommissionEstimates([...vecchie, ...recenti], "2026-10-11");
  assert.equal(r["booking@S"], 24.5);
});

test("struttura con pochi dati: ripiego sulla stima dello stesso canale su tutte le strutture", () => {
  const r = computeCommissionEstimates([...bk(6, { commissionAmount: 24.5, checkIn: "2026-09-20" }), ...bk(2, { structureId: "R", commissionAmount: 17, checkIn: "2026-09-20" })], "2026-10-11");
  assert.equal(r["booking@R"], undefined); // solo 2 dati propri
  assert.ok(typeof r["booking@*"] === "number" && r["booking@*"] > 20 && r["booking@*"] < 25);
});
