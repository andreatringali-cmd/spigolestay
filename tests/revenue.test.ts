import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateImpact, typeDayAvailability } from "../src/lib/revenue-impact.ts";
import { scanGaps } from "../src/lib/revenue-gaps.ts";
import { yoyCompare, realChannelCommission, lastYearDayOcc } from "../src/lib/revenue-yoy.ts";
import { buildChanges, planUndo } from "../src/lib/revenue-history.ts";

// Dati minimi: una struttura, una tipologia "t1" con 2 camere.
const units = [
  { id: "u1", structureId: "s1", roomTypeId: "t1", name: "Uno" },
  { id: "u2", structureId: "s1", roomTypeId: "t1", name: "Due" },
] as never[];
const roomTypes = [{ id: "t1", structureId: "s1", name: "Doppia", minStay: 3 }] as never[];
const bk = (o: Record<string, unknown>) => ({ id: String(Math.random()), structureId: "s1", roomTypeId: "t1", unitId: "u1", guestId: "g", channel: "direct", status: "confirmed", adults: 2, children: 0, ...o }) as never;

test("disponibilità: le prenotazioni senza camera contano sulla tipologia, le annullate no", () => {
  const bookings = [
    bk({ checkIn: "2026-10-10", checkOut: "2026-10-12" }),
    bk({ unitId: null, checkIn: "2026-10-10", checkOut: "2026-10-12" }),
    bk({ unitId: "u2", status: "cancelled", checkIn: "2026-10-10", checkOut: "2026-10-12" }),
  ];
  const a = typeDayAvailability(bookings, units, "t1", "2026-10-10");
  assert.deepEqual(a, { total: 2, sold: 2, free: 0 });
  assert.equal(typeDayAvailability(bookings, units, "t1", "2026-10-12").free, 2); // il giorno di check-out è libero
});

test("impatto: solo le camere libere cambiano, le vendute restano al loro prezzo", () => {
  const bookings = [bk({ checkIn: "2026-10-10", checkOut: "2026-10-11" })]; // 1 su 2 vendute
  const r = simulateImpact([{ typeId: "t1", iso: "2026-10-10", current: 100, next: 120 }], bookings, units);
  assert.equal(r.changes, 1); assert.equal(r.ups, 1);
  assert.equal(r.freeNightRooms, 1); assert.equal(r.soldNightRooms, 1);
  assert.equal(r.net, 20); assert.equal(r.deltaMaxUp, 20); assert.equal(r.deltaMaxDown, 0);
  assert.equal(r.avgDeltaPct, 20);
  // tutto venduto: nessun effetto in €
  const full = [bk({ checkIn: "2026-10-10", checkOut: "2026-10-11" }), bk({ unitId: "u2", checkIn: "2026-10-10", checkOut: "2026-10-11" })];
  assert.equal(simulateImpact([{ typeId: "t1", iso: "2026-10-10", current: 100, next: 80 }], full, units).net, 0);
  // nessuna variazione = nessun cambio
  assert.equal(simulateImpact([{ typeId: "t1", iso: "2026-10-10", current: 100, next: 100 }], [], units).changes, 0);
});

test("storico: l'annullamento ripristina solo ciò che non è stato ritoccato dopo", () => {
  const overrides: Record<string, number> = { "t1|2026-10-10": 90 }; // c'era già un override a 90
  const drafts = [
    { key: "t1|2026-10-10", typeName: "Doppia", iso: "2026-10-10", structureId: "s1", effBefore: 90, after: 110 },
    { key: "t1|2026-10-11", typeName: "Doppia", iso: "2026-10-11", structureId: "s1", effBefore: 100, after: 100 + 1 },
    { key: "t1|2026-10-12", typeName: "Doppia", iso: "2026-10-12", structureId: "s1", effBefore: 100, after: 130 },
  ];
  const changes = buildChanges(drafts, overrides);
  assert.equal(changes.length, 3);
  assert.equal(changes[0].before, 90); assert.equal(changes[1].before, null);
  // dopo l'applicazione: i tre override valgono i valori scritti, ma il terzo viene ritoccato a mano
  const now = { "t1|2026-10-10": 110, "t1|2026-10-11": 101, "t1|2026-10-12": 150 };
  const plan = planUndo({ id: "x", ts: 0, source: "revenue", structureId: "s1", label: "", changes }, now);
  assert.deepEqual(plan.restore, { "t1|2026-10-10": 90 });
  assert.deepEqual(plan.clear, ["t1|2026-10-11"]);
  assert.equal(plan.skipped, 1);
});

test("storico: nessuna modifica se il valore scritto è già quello presente", () => {
  const out = buildChanges([{ key: "k", typeName: "A", iso: "2026-10-10", structureId: "s1", effBefore: 100, after: 100 }], { k: 100 });
  assert.equal(out.length, 0);
});

test("notti orfane: buco di 1-2 notti tra due prenotazioni della stessa camera; minimo notti", () => {
  const bookings = [
    bk({ checkIn: "2026-10-10", checkOut: "2026-10-13" }),
    bk({ checkIn: "2026-10-14", checkOut: "2026-10-16" }), // buco: 13→14 = 1 notte
    bk({ checkIn: "2026-10-21", checkOut: "2026-10-23" }), // buco 16→21 = 5 notti: non orfano
    bk({ unitId: null, checkIn: "2026-10-11", checkOut: "2026-10-12" }), // senza camera
  ];
  const r = scanGaps({ bookings, units, roomTypes, fromISO: "2026-10-01", days: 60, structureId: "s1", rateOf: () => 100 });
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].nights, 1); assert.equal(r.gaps[0].unsellable, true); assert.equal(r.gaps[0].value, 100);
  assert.equal(r.unassigned.length, 1);
  // un'altra struttura non vede nulla
  assert.equal(scanGaps({ bookings, units, roomTypes, fromISO: "2026-10-01", days: 60, structureId: "s2" }).gaps.length, 0);
});

test("anno su anno: stessi giorni della settimana (−364 gg) e ritmo alla stessa data", () => {
  // oggi 2026-10-01; periodo 2026-10-10..12 (3 gg). Anno scorso: −364 gg = 2025-10-11..
  const bookings = [
    bk({ checkIn: "2026-10-10", checkOut: "2026-10-13", total: 300, bookedOn: "2026-09-20" }),
    bk({ checkIn: "2025-10-11", checkOut: "2025-10-14", total: 240, bookedOn: "2025-09-01" }), // già prenotata alla data di oggi-364
    bk({ unitId: "u2", checkIn: "2025-10-11", checkOut: "2025-10-12", total: 90, bookedOn: "2025-10-05" }), // prenotata dopo
  ];
  const y = yoyCompare(bookings, units, "s1", "2026-10-10", 3, "2026-10-01");
  assert.equal(y.hasHistory, true);
  assert.equal(y.now.roomNights, 3);
  assert.equal(y.lastYear.roomNights, 4); // 3 notti + 1 notte
  assert.equal(y.paceReliable, true);
  assert.equal(y.lastYearAtSameDate?.roomNights, 3); // la seconda era prenotata dopo il 2025-10-02
  assert.equal(Math.round(y.now.adr), 100);
  // senza storico: nessun confronto inventato
  const none = yoyCompare([bookings[0]], units, "s1", "2026-10-10", 3, "2026-10-01");
  assert.equal(none.hasHistory, false); assert.equal(none.deltaOccPts, null);
  // giorno singolo
  assert.equal(lastYearDayOcc(bookings, units, "s1", "2026-10-10"), 1); // 2 camere, 2 vendute il 2025-10-11 // 2 camere, 2 vendute il 2025-10-11
});

test("ritmo non affidabile se mancano le date di prenotazione", () => {
  const bookings = [
    bk({ checkIn: "2026-10-10", checkOut: "2026-10-12", total: 200 }),
    bk({ checkIn: "2025-10-11", checkOut: "2025-10-13", total: 180 }), // niente bookedOn
  ];
  const y = yoyCompare(bookings, units, "s1", "2026-10-10", 2, "2026-10-01");
  assert.equal(y.paceReliable, false); assert.equal(y.lastYearAtSameDate, null); assert.equal(y.deltaPaceOccPts, null);
});

test("commissioni reali: importo o percentuale registrati, altrimenti nessun dato", () => {
  const bookings = [
    bk({ channel: "booking", total: 200, commissionAmount: 30, checkIn: "2026-06-01", checkOut: "2026-06-03" }),
    bk({ channel: "booking", total: 100, commissionPct: 10, checkIn: "2026-06-05", checkOut: "2026-06-06" }),
    bk({ channel: "booking", total: 100, checkIn: "2026-06-07", checkOut: "2026-06-08" }), // senza commissione: ignorata
    bk({ channel: "airbnb", total: 100, checkIn: "2026-06-07", checkOut: "2026-06-08" }),
  ];
  const r = realChannelCommission(bookings, "booking", "s1", "2025-10-01");
  assert.equal(r?.n, 2); assert.equal(Math.round((r?.pct ?? 0) * 1000), 133); // (30+10)/300
  assert.equal(realChannelCommission(bookings, "airbnb", "s1", "2025-10-01"), null);
  assert.equal(realChannelCommission(bookings, "booking", "s2", "2025-10-01"), null);
});
