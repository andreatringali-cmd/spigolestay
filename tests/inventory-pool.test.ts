import test from "node:test";
import assert from "node:assert/strict";
import { parsePool, physicalKey, poolOccupancy, inPool } from "../src/lib/inventory-pool.ts";

// Le camere reali: Spigolehouse ha 1,3,4 (Deluxe), 2 (Tripla) e le 5-8 che sono anche Spigolerooms (#5,#6,#7 Deluxe, #8 Junior Suite).
// In Xenora la "8" di Spigolehouse è una Deluxe "virtuale": è la stessa camera della Junior Suite #8.
const H = "H", R = "R";
const units = [
  { id: "h1", name: "1", roomTypeId: "hDeluxe", structureId: H }, { id: "h2", name: "2", roomTypeId: "hTripla", structureId: H },
  { id: "h3", name: "3", roomTypeId: "hDeluxe", structureId: H }, { id: "h4", name: "4", roomTypeId: "hDeluxe", structureId: H },
  { id: "h5", name: "5", roomTypeId: "hDeluxe", structureId: H }, { id: "h6", name: "6", roomTypeId: "hDeluxe", structureId: H },
  { id: "h7", name: "7", roomTypeId: "hDeluxe", structureId: H }, { id: "h8", name: "8", roomTypeId: "hDeluxe", structureId: H },
  { id: "r5", name: "#5", roomTypeId: "rDeluxe", structureId: R }, { id: "r6", name: "#6", roomTypeId: "rDeluxe", structureId: R },
  { id: "r7", name: "#7", roomTypeId: "rDeluxe", structureId: R }, { id: "r8", name: "#8", roomTypeId: "rJunior", structureId: R },
];
const cfg = parsePool(JSON.stringify({ enabled: true, structureIds: [H, R] }));
const bk = (unitId: string | null, structureId: string, checkIn = "2026-10-10", checkOut = "2026-10-11", roomTypeId = "x", status = "confirmed") => ({ unitId, structureId, checkIn, checkOut, roomTypeId, status });
const day = "2026-10-10";

test("parsePool: serve almeno due strutture", () => {
  assert.equal(parsePool(null).enabled, false);
  assert.equal(parsePool(JSON.stringify({ enabled: true, structureIds: ["H"] })).enabled, false);
  assert.equal(parsePool("non json").enabled, false);
  assert.equal(cfg.enabled, true);
  assert.equal(inPool(cfg, H), true);
  assert.equal(inPool(cfg, "ALTRA"), false);
});

test("physicalKey: '5', '#5' e 'Camera 05' sono la stessa camera", () => {
  assert.equal(physicalKey({ id: "a", name: "5" }), "5");
  assert.equal(physicalKey({ id: "a", name: "#5" }), "5");
  assert.equal(physicalKey({ id: "a", name: "Camera 05" }), "5");
  assert.equal(physicalKey({ id: "zz", name: "Suite" }), "u:zz");
});

test("senza prenotazioni: ogni tipologia mostra le sue camere", () => {
  const o = poolOccupancy(cfg, units, []);
  assert.equal(o.availFor("hDeluxe", day), 7);
  assert.equal(o.availFor("hTripla", day), 1);
  assert.equal(o.availFor("rDeluxe", day), 3);
  assert.equal(o.availFor("rJunior", day), 1);
});

test("la Junior Suite #8 occupata chiude anche la '8' di Spigolehouse", () => {
  const o = poolOccupancy(cfg, units, [bk("r8", R, day, "2026-10-11", "rJunior")]);
  assert.equal(o.availFor("rJunior", day), 0);
  assert.equal(o.availFor("hDeluxe", day), 6); // 7 meno la "8" che è la stessa camera
  assert.equal(o.availFor("rDeluxe", day), 3); // le #5-#7 non sono toccate
});

test("una prenotazione sulla '6' di Spigolehouse chiude la #6 di Spigolerooms (e viceversa)", () => {
  const a = poolOccupancy(cfg, units, [bk("h6", H, day, "2026-10-11", "hDeluxe")]);
  assert.equal(a.availFor("rDeluxe", day), 2);
  assert.equal(a.availFor("hDeluxe", day), 6);
  const b = poolOccupancy(cfg, units, [bk("r5", R, day, "2026-10-11", "rDeluxe")]);
  assert.equal(b.availFor("hDeluxe", day), 6);
  assert.equal(b.availFor("rDeluxe", day), 2);
});

test("la Tripla (camera 2) occupata chiude solo la Tripla", () => {
  const o = poolOccupancy(cfg, units, [bk("h2", H, day, "2026-10-11", "hTripla")]);
  assert.equal(o.availFor("hTripla", day), 0);
  assert.equal(o.availFor("hDeluxe", day), 7);
  assert.equal(o.availFor("rDeluxe", day), 3);
  assert.equal(o.availFor("rJunior", day), 1);
});

test("tutte occupate: tutto chiuso; annullate e giorni fuori periodo non contano; chiusure manuali si sottraggono", () => {
  const all = units.filter((u) => u.id !== "r5" && u.id !== "r6" && u.id !== "r7" && u.id !== "r8").map((u) => bk(u.id, H, day, "2026-10-11"));
  const full = poolOccupancy(cfg, units, all);
  assert.equal(full.availFor("hDeluxe", day), 0);
  assert.equal(full.availFor("rDeluxe", day), 0); // #5-#7 sono le stesse 5-7
  assert.equal(full.availFor("rJunior", day), 0);
  const o = poolOccupancy(cfg, units, [bk("h1", H, day, "2026-10-11", "hDeluxe", "cancelled"), bk("h3", H, "2026-10-11", "2026-10-12", "hDeluxe")]);
  assert.equal(o.availFor("hDeluxe", day), 7);
  assert.equal(o.availFor("hDeluxe", day, 2), 5);
});

test("prenotazione senza camera assegnata riduce la sua tipologia", () => {
  const o = poolOccupancy(cfg, units, [bk(null, H, day, "2026-10-11", "hDeluxe")]);
  assert.equal(o.availFor("hDeluxe", day), 6);
  assert.equal(o.availFor("rDeluxe", day), 3);
});

test("unitFreeForStay: la camera fisica è libera solo se lo è in tutto il soggiorno e in tutto il gruppo", () => {
  const o = poolOccupancy(cfg, units, [bk("r6", R, "2026-10-12", "2026-10-14", "rDeluxe")]);
  const h6 = units.find((u) => u.id === "h6")!;
  assert.equal(o.unitFreeForStay(h6, "2026-10-10", "2026-10-12"), true);  // finisce il giorno in cui arriva l'altro
  assert.equal(o.unitFreeForStay(h6, "2026-10-11", "2026-10-13"), false); // si sovrappone
  assert.equal(o.unitFreeForStay(h6, "2026-10-14", "2026-10-16"), true);
});
