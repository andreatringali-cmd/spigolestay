import test from "node:test";
import assert from "node:assert/strict";
import { parsePool, physicalKey, poolOccupancy, inPool } from "../src/lib/inventory-pool.ts";

// Camere reali: Spigolehouse 1,3,4,5,6,7 (Deluxe) e 2 (Tripla); le camere 5-8 sono anche Spigolerooms (#5,#6,#7 Deluxe, #8 Junior Suite).
// In Xenora la Deluxe di Spigolehouse ha 7 camere (1,3,4,5,6,7,8): la "8" è la stessa camera della Junior Suite #8.
const H = "H", R = "R";
const roomTypes = [
  { id: "hDeluxe", name: "Deluxe", structureId: H }, { id: "hTripla", name: "Tripla", structureId: H },
  { id: "rDeluxe", name: "Deluxe", structureId: R }, { id: "rJunior", name: "Junior Suite", structureId: R },
];
const units = [
  ...["1", "3", "4", "5", "6", "7", "8"].map((n) => ({ id: "h" + n, name: n, roomTypeId: "hDeluxe" })),
  { id: "h2", name: "2", roomTypeId: "hTripla" },
  ...["#5", "#6", "#7"].map((n) => ({ id: "r" + n, name: n, roomTypeId: "rDeluxe" })),
  { id: "r8", name: "#8", roomTypeId: "rJunior" },
];
const cfg = parsePool(JSON.stringify({ enabled: true, structureIds: [H, R] }));
const day = "2026-10-10", next = "2026-10-11";
const bk = (roomTypeId: string, n = 1, checkIn = day, checkOut = next, status = "confirmed") => Array.from({ length: n }, () => ({ roomTypeId, checkIn, checkOut, status }));
const av = (bookings: ReturnType<typeof bk>, closed = 0, d = day) => {
  const o = poolOccupancy(cfg, roomTypes, units, bookings);
  return { HD: o.availFor("hDeluxe", d, closed), HT: o.availFor("hTripla", d), RD: o.availFor("rDeluxe", d, closed), RJ: o.availFor("rJunior", d), o };
};

test("parsePool e physicalKey", () => {
  assert.equal(parsePool(null).enabled, false);
  assert.equal(parsePool(JSON.stringify({ enabled: true, structureIds: ["H"] })).enabled, false);
  assert.equal(parsePool("non json").enabled, false);
  assert.equal(cfg.enabled, true);
  assert.equal(inPool(cfg, H), true);
  assert.equal(inPool(cfg, "ALTRA"), false);
  assert.equal(physicalKey({ id: "a", name: "#5" }), "5");
  assert.equal(physicalKey({ id: "zz", name: "Suite" }), "u:zz");
});

test("le camere fisiche si ricavano dalle tipologie: 6 Deluxe, 1 Tripla, 1 Junior Suite", () => {
  const s = poolOccupancy(cfg, roomTypes, units, []).summary();
  assert.deepEqual(Object.fromEntries(s.map((f) => [f.name, f.rooms])), { deluxe: 6, tripla: 1, juniorsuite: 1 });
});

test("senza prenotazioni: la Deluxe di Spigolehouse mostra 7 (6 + la Junior come settima), Spigolerooms 3 + 1", () => {
  assert.deepEqual({ HD: av([]).HD, HT: av([]).HT, RD: av([]).RD, RJ: av([]).RJ }, { HD: 7, HT: 1, RD: 3, RJ: 1 });
});

test("una Deluxe prenotata in una struttura riduce la disponibilità dell'altra (e viceversa)", () => {
  const a = av(bk("rDeluxe", 2)); // 2 su Spigolerooms
  assert.equal(a.HD, 5); assert.equal(a.RD, 1);
  const b = av(bk("hDeluxe", 2)); // 2 su Spigolehouse
  assert.equal(b.HD, 5); assert.equal(b.RD, 3); // Spigolerooms resta al suo massimo (3) perché le Deluxe libere sono 4
  const c = av(bk("hDeluxe", 4));
  assert.equal(c.RD, 2); // restano 2 Deluxe libere: Spigolerooms ne può vendere al massimo 2
});

test("la Junior Suite occupata chiude la camera in più della Deluxe di Spigolehouse", () => {
  const a = av(bk("rJunior", 1));
  assert.equal(a.RJ, 0); assert.equal(a.HD, 6); assert.equal(a.RD, 3);
});

test("Spigolehouse piena di Deluxe (7) usa anche la Junior Suite", () => {
  const a = av(bk("hDeluxe", 7));
  assert.equal(a.HD, 0); assert.equal(a.RD, 0); assert.equal(a.RJ, 0);
});

test("allineamento: con Tripla e Junior Suite occupate le due Deluxe mostrano lo stesso numero", () => {
  const a = av([...bk("hTripla", 1), ...bk("rJunior", 1), ...bk("hDeluxe", 3)]);
  assert.equal(a.HT, 0); assert.equal(a.RJ, 0);
  assert.equal(a.HD, 3); assert.equal(a.RD, 3);
  const b = av([...bk("hTripla", 1), ...bk("rJunior", 1), ...bk("hDeluxe", 4)]);
  assert.equal(b.HD, 2); assert.equal(b.RD, 2);
});

test("la Tripla occupata chiude solo la Tripla", () => {
  const a = av(bk("hTripla", 1));
  assert.equal(a.HT, 0); assert.equal(a.HD, 7); assert.equal(a.RD, 3); assert.equal(a.RJ, 1);
});

test("annullate e giorni fuori periodo non contano; le chiusure manuali si sottraggono", () => {
  const a = av([...bk("hDeluxe", 2, day, next, "cancelled"), ...bk("hDeluxe", 1, "2026-10-12", "2026-10-13")]);
  assert.equal(a.HD, 7);
  assert.equal(av([], 2).HD, 5);
});

test("canSell: serve disponibilità in tutte le notti", () => {
  const o = poolOccupancy(cfg, roomTypes, units, [...bk("hDeluxe", 6, "2026-10-12", "2026-10-13"), ...bk("rJunior", 1, "2026-10-12", "2026-10-13")]);
  assert.equal(o.canSell("rDeluxe", "2026-10-10", "2026-10-12"), true);
  assert.equal(o.canSell("rDeluxe", "2026-10-11", "2026-10-13"), false); // il 12 le Deluxe sono finite
  assert.equal(o.canSell("rJunior", "2026-10-12", "2026-10-13"), false);
});
