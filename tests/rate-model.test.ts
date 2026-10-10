import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import {
  parseRateModel, rateModelActive, planRate, singleOccupancyRate, occupancyRates, extraPlanRow, ratePlanCreateBody, RATEMODEL_DEF,
} from "../src/lib/rate-model.ts";

// buildAriPayload importa "@/lib/..." e moduli senza estensione: li risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const { buildAriPayload } = await import("../src/lib/channex-ari.ts");

const S = "S1";
const roomTypes = [{ id: "rt1", structureId: S, name: "Doppia", beds: 2, basePrice: 100 }] as never[];
const units = [{ id: "u1", roomTypeId: "rt1", structureId: S, name: "1" }, { id: "u2", roomTypeId: "rt1", structureId: S, name: "2" }] as never[];
const bookings: never[] = [];
const mapBase = { propertyId: "P", rooms: { rt1: { roomTypeId: "CR1", ratePlanId: "RP1" } } };
const mapExtra = { propertyId: "P", rooms: { rt1: { roomTypeId: "CR1", ratePlanId: "RP1", ratePlans: [{ id: "nr", ratePlanId: "RP2", perPerson: true, occupancy: 2 }, { id: "bb", ratePlanId: "RP3" }] } } };
const cfgOn = parseRateModel(JSON.stringify({
  enabled: true,
  plans: { rt1: [{ id: "nr", name: "Non rimborsabile", adjPct: -10 }, { id: "bb", name: "Colazione", adjEur: 8, minStay: 2 }] },
  single: { rt1: { mode: "pct", value: 15 } },
}));
const run = (map: unknown, rateModel?: unknown, extra: object = {}) =>
  buildAriPayload(map as never, S, roomTypes, units, bookings, {}, { days: 14, weekendPct: 25, rateModel: rateModel as never, ...extra });

test("parseRateModel: default spento e input sporchi", () => {
  assert.deepEqual(parseRateModel(null), RATEMODEL_DEF);
  assert.equal(parseRateModel("{rotto").enabled, false);
  assert.equal(parseRateModel(JSON.stringify({ enabled: "true" })).enabled, false);
  const p = parseRateModel(JSON.stringify({ enabled: true, plans: { a: [{ id: "x", name: "N", adjPct: "boh", minStay: 1 }, { nome: "senza id" }], b: "no" }, single: { a: { mode: "eur", value: 5 }, c: { value: 0 } } }));
  assert.deepEqual(p.plans, { a: [{ id: "x", name: "N", adjPct: undefined, adjEur: undefined, minStay: undefined }] });
  assert.deepEqual(p.single, { a: { mode: "eur", value: 5 } });
  assert.equal(rateModelActive(parseRateModel(JSON.stringify({ enabled: true }))), false); // acceso ma vuoto = inattivo
  assert.equal(rateModelActive(cfgOn), true);
});

test("planRate e singleOccupancyRate", () => {
  assert.equal(planRate(100, { adjPct: -10 }), 90);
  assert.equal(planRate(100, { adjEur: 8 }), 108);
  assert.equal(planRate(100, { adjPct: 10, adjEur: -5 }), 105);
  assert.equal(planRate(100, { adjPct: -150 }), 0);
  assert.equal(planRate(99.99, { adjPct: 3 }), 102.99);
  assert.equal(singleOccupancyRate(90, { mode: "pct", value: 15 }), 76.5);
  assert.equal(singleOccupancyRate(90, { mode: "eur", value: 20 }), 70);
  assert.equal(singleOccupancyRate(10, { mode: "eur", value: 20 }), 0);
  assert.equal(singleOccupancyRate(90, undefined), 90);
  assert.deepEqual(occupancyRates(90, { mode: "pct", value: 10 }, 2), [{ occupancy: 1, rate: 81 }, { occupancy: 2, rate: 90 }]);
  assert.deepEqual(occupancyRates(90, undefined, 2), [{ occupancy: 2, rate: 90 }]);
  assert.deepEqual(occupancyRates(90, { mode: "pct", value: 10 }, 1), [{ occupancy: 1, rate: 90 }]);
});

test("retrocompatibilità: impostazione OFF -> output di buildAriPayload IDENTICO a oggi", () => {
  const baseline = run(mapBase);
  // valori fissi attesi (basePrice 100, weekend +25%): se cambiano, la tariffa unica di oggi è stata toccata
  assert.equal(baseline.availability.length, 14);
  assert.equal(baseline.restrictions.length, 14);
  let weekends = 0;
  for (const r of baseline.restrictions) {
    assert.deepEqual(Object.keys(r).sort(), ["date", "property_id", "rate", "rate_plan_id"]);
    assert.equal(r.rate_plan_id, "RP1");
    assert.ok(r.rate === "100.00" || r.rate === "125.00");
    if (r.rate === "125.00") weekends++;
  }
  assert.ok(weekends >= 2 && weekends <= 6); // 14 giorni consecutivi contengono 4 giorni di weekend (ven+sab)
  assert.ok(baseline.availability.every((a) => a.availability === 2 && a.room_type_id === "CR1"));
  // senza opzione, con opzione undefined, spenta, spenta ma con piani definiti, accesa ma mappa senza ratePlans
  assert.deepEqual(run(mapBase, undefined), baseline);
  assert.deepEqual(run(mapBase, RATEMODEL_DEF), baseline);
  assert.deepEqual(run(mapBase, { ...cfgOn, enabled: false }), baseline);
  assert.deepEqual(run(mapBase, cfgOn), baseline);
  // mappa con ratePlans ma modello spento / non passato: le righe sono le stesse di prima
  assert.deepEqual(run(mapExtra), baseline);
  assert.deepEqual(run(mapExtra, { ...cfgOn, enabled: false }), baseline);
});

test("modello ACCESO: righe extra per ogni piano mappato, base invariata", () => {
  const baseline = run(mapBase);
  const on = run(mapExtra, cfgOn);
  assert.deepEqual(on.availability, baseline.availability); // disponibilità mai toccata
  assert.equal(on.restrictions.length, 14 * 3);
  assert.deepEqual(on.restrictions.filter((r) => r.rate_plan_id === "RP1"), baseline.restrictions);
  const nr = on.restrictions.filter((r) => r.rate_plan_id === "RP2");
  const bb = on.restrictions.filter((r) => r.rate_plan_id === "RP3");
  assert.equal(nr.length, 14); assert.equal(bb.length, 14);
  baseline.restrictions.forEach((b, i) => {
    const base = Number(b.rate);
    assert.equal(nr[i].date, b.date);
    assert.equal(nr[i].rate, planRate(base, { adjPct: -10 }).toFixed(2));
    assert.deepEqual(nr[i].rates, [{ occupancy: 1, rate: singleOccupancyRate(planRate(base, { adjPct: -10 }), { mode: "pct", value: 15 }).toFixed(2) }]);
    assert.equal(bb[i].rate, (base + 8).toFixed(2));
    assert.equal(bb[i].rates, undefined);        // piano per camera: nessun prezzo per occupazione
    assert.equal(bb[i].min_stay_arrival, 2);     // restrizione del piano
    assert.equal(nr[i].min_stay_arrival, undefined);
  });
});

test("piani extra ereditano chiusure, stop-sell e minimo soggiorno più alto", () => {
  const iso = run(mapBase).restrictions[0].date!;
  const closed = run(mapExtra, cfgOn, { cta: { [`rt1|${iso}`]: true }, closes: { [`rt1|${iso}`]: 2 } });
  for (const id of ["RP1", "RP2", "RP3"]) {
    const r = closed.restrictions.find((x) => x.rate_plan_id === id && x.date === iso)!;
    assert.equal(r.closed_to_arrival, true); assert.equal(r.stop_sell, true);
  }
  const ms = [{ ...(roomTypes[0] as object), minStay: 3 }] as never[];
  const withMin = buildAriPayload(mapExtra as never, S, ms, units, bookings, {}, { days: 3, rateModel: cfgOn });
  assert.ok(withMin.restrictions.every((r) => r.min_stay_arrival === 3)); // max(3, 2) per BB, 3 per gli altri
});

test("piano mappato ma non definito (o senza ratePlanId) viene ignorato; rate override rispettato", () => {
  const map = { propertyId: "P", rooms: { rt1: { roomTypeId: "CR1", ratePlanId: "RP1", ratePlans: [{ id: "sconosciuto", ratePlanId: "RPX" }, { id: "nr", ratePlanId: "" }] } } };
  assert.deepEqual(run(map, cfgOn), run(mapBase));
  const iso = run(mapBase).restrictions[0].date!;
  const o = buildAriPayload(mapExtra as never, S, roomTypes, units, bookings, { [`rt1|${iso}`]: 200 }, { days: 1, rateModel: cfgOn });
  assert.equal(o.restrictions.find((r) => r.rate_plan_id === "RP2")!.rate, "180.00");
});

test("extraPlanRow non muta la riga base", () => {
  const base = { property_id: "P", rate_plan_id: "A", date: "2026-01-01", rate: "100.00", stop_sell: true };
  const copy = { ...base };
  const r = extraPlanRow(base, { id: "x", ratePlanId: "B" }, { id: "x", name: "x", adjPct: 5 }, undefined, 0);
  assert.deepEqual(base, copy);
  assert.equal(r.rate, "105.00"); assert.equal(r.rate_plan_id, "B"); assert.equal(r.stop_sell, true);
});

test("ratePlanCreateBody: per camera senza sconto, per persona con sconto", () => {
  const a = ratePlanCreateBody("P", "R", { title: "NR", baseRate: 100, plan: { adjPct: -10 }, occupancy: 2 });
  assert.equal(a.rate_plan.sell_mode, "per_room");
  assert.deepEqual(a.rate_plan.options, [{ occupancy: 2, is_primary: true, rate: 90 }]);
  const b = ratePlanCreateBody("P", "R", { title: "NR", baseRate: 100, plan: { adjPct: -10 }, single: { mode: "eur", value: 20 }, occupancy: 2 });
  assert.equal(b.rate_plan.sell_mode, "per_person");
  assert.deepEqual(b.rate_plan.options, [{ occupancy: 1, is_primary: false, rate: 70 }, { occupancy: 2, is_primary: true, rate: 90 }]);
  assert.equal(ratePlanCreateBody("P", "R", { title: "x", baseRate: 50, plan: {}, single: { mode: "pct", value: 10 }, occupancy: 1 }).rate_plan.sell_mode, "per_room");
});
