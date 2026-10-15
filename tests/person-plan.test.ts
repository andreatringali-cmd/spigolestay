import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { singleDiscountFromDerived } = await import("../src/lib/person-plan.ts");
const { extraPlanRow } = await import("../src/lib/rate-model.ts");

test("sconto per 1 ospite dalla tariffa derivata 'uso singola' (Dus = madre −10%)", () => {
  assert.deepEqual(singleDiscountFromDerived({ deriveMode: "percent", deriveValue: -10 }), { mode: "pct", value: 10 });
  assert.deepEqual(singleDiscountFromDerived({ deriveMode: "amount", deriveValue: -10 }), { mode: "eur", value: 10 });
  assert.equal(singleDiscountFromDerived({ deriveMode: "percent", deriveValue: 10 }), null); // un aumento non è uno sconto
  assert.equal(singleDiscountFromDerived({ deriveMode: "percent" }), null);
});

test("piano per persona: riga del giorno con il prezzo per 2 ospiti e quello per 1 ospite, stesse chiusure della riga base", () => {
  const base = { property_id: "p1", rate_plan_id: "base", date: "2026-12-20", rate: "99.00", stop_sell: true };
  const row = extraPlanRow(base, { id: "pp", ratePlanId: "rp-pp", perPerson: true, occupancy: 2 }, { id: "pp", name: "Per persona", adjPct: 0, adjEur: 0 }, { mode: "eur", value: 10 }, 0);
  assert.equal(row.rate_plan_id, "rp-pp");
  assert.equal(row.rate, "99.00");
  assert.deepEqual(row.rates, [{ occupancy: 1, rate: "89.00" }]);
  assert.equal(row.stop_sell, true);
  const pct = extraPlanRow(base, { id: "pp", ratePlanId: "rp-pp", perPerson: true, occupancy: 2 }, { id: "pp", name: "Per persona" }, { mode: "pct", value: 10 }, 0);
  assert.deepEqual(pct.rates, [{ occupancy: 1, rate: "89.10" }]);
});
