import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adempimentiHealth, histogram, LEAD_LABELS, LEAD_UPPER, leadDays, normCountry, occupancyStrip, pickupDaily, rateSeries, stayNights,
  STAY_LABELS, STAY_UPPER, topCountries, type DBooking, type DUnit,
} from "../src/lib/dashboard.ts";

const T = "2026-10-06";
let n = 0;
const bk = (o: Partial<DBooking> & { checkIn: string; checkOut: string }): DBooking => ({
  id: `x${++n}`, guestId: `g${n}`, structureId: "s1", unitId: null, channel: "booking", status: "confirmed", adults: 2, children: 0, ...o,
});

test("striscia: finestra che parte nel passato, 'oggi' giusto e ospiti in casa (esclusi arrivo e partenza)", () => {
  const units: DUnit[] = [{ id: "u1", structureId: "s1" }, { id: "u2", structureId: "s1" }];
  const live = [bk({ checkIn: "2026-10-03", checkOut: "2026-10-07", unitId: "u1" }), bk({ checkIn: "2026-10-05", checkOut: T, unitId: "u2" })];
  const cells = occupancyStrip(live, units, "2026-10-04", 4, T); // 4, 5, 6, 7 ottobre
  assert.deepEqual(cells.map((c) => c.isToday), [false, false, true, false]);
  assert.deepEqual(cells.map((c) => c.stay), [1, 1, 1, 0]);
  assert.deepEqual(cells.map((c) => c.occupied), [1, 2, 1, 0]);
  assert.deepEqual(cells.map((c) => c.arrivals), [0, 1, 0, 0]);
  assert.deepEqual(cells.map((c) => c.departures), [0, 0, 1, 1]);
});

test("salute adempimenti: passaggi fatti sul totale, tassa solo a chi parte oggi, niente rilevanti = 100%", () => {
  const a = bk({ checkIn: T, checkOut: "2026-10-09" });
  const b = bk({ checkIn: "2026-10-03", checkOut: T });
  const far = bk({ checkIn: "2026-10-20", checkOut: "2026-10-22" });
  const old = bk({ checkIn: "2026-09-20", checkOut: "2026-09-22" });
  const st = (o: Record<string, "done" | "todo" | "late" | "na">) => Object.entries(o).map(([key, state]) => ({ key, state }));
  const j = (x: DBooking) => (x.id === a.id ? st({ checkin: "todo", pay: "done", tax: "todo", alloggiati: "todo", istat: "todo" }) : st({ checkin: "done", pay: "late", tax: "done", alloggiati: "done", guide: "todo" }));
  // a: checkin, pay, alloggiati (3 passaggi, 1 fatto; tassa esclusa perché non parte oggi) · b: 4 passaggi, 3 fatti
  assert.deepEqual(adempimentiHealth([a, b, far, old], T, j), { done: 4, total: 7, pct: 57 });
  assert.deepEqual(adempimentiHealth([far, old], T, j), { done: 0, total: 0, pct: 100 });
  assert.equal(adempimentiHealth([a], T, () => null).pct, 100);
  assert.equal(adempimentiHealth([a], T, () => st({ pay: "na" })).total, 0);
});

test("pickup: conta per giorno di ricezione, ignora fuori finestra e date non valide, confronto settimanale", () => {
  const mk = (d?: string) => ({ bookedOn: d });
  const list = [mk(T), mk(T), mk("2026-10-04"), mk("2026-09-29"), mk("2026-09-28"), mk("2026-09-10"), mk("2026-08-01"), mk("2026-10-07"), mk("boh"), mk(undefined)];
  const p = pickupDaily(list, T, 30);
  assert.equal(p.days.length, 30);
  assert.equal(p.days[29].iso, T); assert.equal(p.days[29].count, 2);
  assert.equal(p.days[0].iso, "2026-09-07");
  assert.equal(p.total, 6);       // esclusi: 1 agosto, 7 ottobre (futuro), date non valide
  assert.equal(p.last7, 3);       // 30/9 → 6/10: 2 oggi + 4 ottobre
  assert.equal(p.prev7, 2);       // 23/9 → 29/9: 29/9 e 28/9
  assert.equal(p.deltaPct, 50);
  assert.equal(pickupDaily([], T).deltaPct, null);
});

test("istogrammi: fasce chiuse, ultima fascia aperta, media", () => {
  const h = histogram([0, 1, 2, 7, 8, 30, 31, 61, 400], LEAD_UPPER, LEAD_LABELS);
  assert.deepEqual(h.counts, [2, 2, 1, 1, 1, 2]);
  assert.equal(h.total, 9);
  assert.equal(h.avg, (0 + 1 + 2 + 7 + 8 + 30 + 31 + 61 + 400) / 9);
  const d = histogram([1, 2, 2, 3, 5, 6, 7, 14], STAY_UPPER, STAY_LABELS);
  assert.deepEqual(d.counts, [1, 2, 1, 0, 2, 2]);
  assert.equal(histogram([], STAY_UPPER, STAY_LABELS).avg, null);
});

test("anticipo e durata: date non valide o incoerenti non contano", () => {
  assert.equal(leadDays({ bookedOn: "2026-09-26", checkIn: T }), 10);
  assert.equal(leadDays({ bookedOn: "2026-10-06", checkIn: T }), 0);
  assert.equal(leadDays({ bookedOn: "2026-10-09", checkIn: T }), null);
  assert.equal(leadDays({ checkIn: T }), null);
  assert.equal(leadDays({ bookedOn: "ieri", checkIn: T }), null);
  assert.equal(stayNights({ checkIn: T, checkOut: "2026-10-09" }), 3);
  assert.equal(stayNights({ checkIn: T, checkOut: T }), 1);
});

test("ADR e RevPAR: medie pesate, giorni vuoti a zero", () => {
  const r = rateSeries([100, 0, 300], [1, 0, 2], 4);
  assert.deepEqual(r.adr, [100, 0, 150]);
  assert.deepEqual(r.revpar, [25, 0, 75]);
  assert.equal(r.adrAvg, 400 / 3);
  assert.equal(r.revparAvg, 400 / 12);
  const z = rateSeries([50], [0], 0);
  assert.equal(z.adrAvg, 0); assert.equal(z.revparAvg, 0);
});

test("provenienza: codici e nomi, ignora i non indicati, primi N con quota", () => {
  assert.equal(normCountry("it"), "IT"); assert.equal(normCountry("Germania"), "DE"); assert.equal(normCountry("UK"), "GB");
  assert.equal(normCountry("Non indicato"), null); assert.equal(normCountry(""), null); assert.equal(normCountry(undefined), null);
  const t = topCountries(["IT", "IT", "Italia", "DE", "DE", "FR", "Non indicato", undefined, "US", "ES", "PL"], 3);
  assert.equal(t.known, 9);
  assert.deepEqual(t.rows.map((r) => [r.code, r.count, r.share]), [["IT", 3, 33], ["DE", 2, 22], ["ES", 1, 11]]); // pari merito: ordine alfabetico
  assert.equal(t.rows[0].name, "Italia");
  assert.deepEqual(topCountries([], 5), { rows: [], known: 0 });
});
