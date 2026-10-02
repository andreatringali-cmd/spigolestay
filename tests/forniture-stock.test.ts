import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateStock, stockState, reorderQty } from "../src/lib/forniture/forecast.ts";

const product = { consumption_per_arrival: 1, consumption_per_guest_night: 2 };
const bk = (ci: string, co: string, adults = 2) => ({ structureId: "s1", checkIn: ci, checkOut: co, adults, status: "confirmed" });

test("stima: sottrae il consumo dal conteggio a oggi", () => {
  // conteggio 2026-10-01, oggi 2026-10-05: 1 arrivo il 02 (2 notti, 2 ospiti) = 1 + 2*2*2 = 9
  const e = estimateStock({ bookings: [bk("2026-10-02", "2026-10-04")], structureId: "s1", product, counted: 100, countedAtISO: "2026-10-01", todayISO: "2026-10-05" });
  assert.equal(e.consumed, 9);
  assert.equal(e.estimated, 91);
});

test("stima: mai sotto zero e altra struttura ignorata", () => {
  const e = estimateStock({ bookings: [bk("2026-10-02", "2026-10-04"), { ...bk("2026-10-02", "2026-10-04"), structureId: "s2" }], structureId: "s1", product, counted: 5, countedAtISO: "2026-10-01", todayISO: "2026-10-05" });
  assert.equal(e.estimated, 0);
});

test("copertura giorni dal consumo atteso", () => {
  // oggi 10-05, orizzonte 10 giorni, 1 arrivo 10-06 di 1 notte, 2 ospiti: 1 + 4 = 5 -> 0.5/giorno; scorta 10 -> 20 giorni
  const e = estimateStock({ bookings: [bk("2026-10-06", "2026-10-07")], structureId: "s1", product, counted: 10, countedAtISO: "2026-10-05", todayISO: "2026-10-05", horizonDays: 10 });
  assert.equal(e.dailyRate, 0.5);
  assert.equal(e.coverageDays, 20);
});

test("stato scorta", () => {
  assert.equal(stockState(0, 5, true), "out");
  assert.equal(stockState(4, 5, true), "low");
  assert.equal(stockState(5, 5, true), "low");
  assert.equal(stockState(6, 5, true), "ok");
  assert.equal(stockState(0, 0, false), "none");
});

test("quantità di riordino arrotondata al pack", () => {
  assert.equal(reorderQty({ estimated: 10, min: 20, dailyRate: 3, horizonDays: 30, packSize: 50 }), 100); // 90+20-10=100
  assert.equal(reorderQty({ estimated: 500, min: 20, dailyRate: 1, horizonDays: 30, packSize: 50 }), 0);
});
