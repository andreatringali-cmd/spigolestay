import test from "node:test";
import assert from "node:assert/strict";
import { parsePool, famKeyOf, poolListings, poolFamilies, poolOccupancy, inPool } from "../src/lib/inventory-pool.ts";

// Due strutture nello stesso edificio. Camere reali: 6 Deluxe, 1 Tripla, 1 Junior Suite. Sui portali ogni struttura ne mostra più delle reali.
const H = "H", R = "R";
const roomTypes = [
  { id: "hD", name: "Deluxe", structureId: H }, { id: "hT", name: "Tripla", structureId: H }, { id: "hJ", name: "Junior Suite", structureId: H },
  { id: "rD", name: "Deluxe", structureId: R }, { id: "rT", name: "Tripla", structureId: R }, { id: "rJ", name: "junior suite", structureId: R },
  { id: "x", name: "Altra", structureId: "X" },
];
const mk = (typeId: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${typeId}-${i}`, roomTypeId: typeId }));
const units = [...mk("hD", 7), ...mk("hT", 1), ...mk("hJ", 1), ...mk("rD", 3), ...mk("rT", 1), ...mk("rJ", 1), ...mk("x", 2)];
const cfgOf = (extra: Record<string, unknown> = {}) => parsePool(JSON.stringify({ enabled: true, structureIds: [H, R], rooms: { deluxe: 6, tripla: 1, juniorsuite: 1 }, ...extra }));
const cfg = cfgOf();
const day = "2026-10-10", next = "2026-10-11";
const bk = (roomTypeId: string, n = 1, checkIn = day, checkOut = next, status = "confirmed") => Array.from({ length: n }, () => ({ roomTypeId, checkIn, checkOut, status }));
const a = (bookings: ReturnType<typeof bk>, c = cfg, closed = 0) => {
  const o = poolOccupancy(c, roomTypes, units, bookings);
  return { hD: o.availFor("hD", day, closed), hT: o.availFor("hT", day), hJ: o.availFor("hJ", day), rD: o.availFor("rD", day, closed), rT: o.availFor("rT", day), rJ: o.availFor("rJ", day), o };
};

test("parsePool: serve almeno due strutture; ripulisce i dati sporchi", () => {
  assert.equal(parsePool(null).enabled, false);
  assert.equal(parsePool(JSON.stringify({ enabled: true, structureIds: ["H"] })).enabled, false);
  assert.equal(parsePool("non json").enabled, false);
  const p = parsePool(JSON.stringify({ enabled: true, structureIds: [H, R], rooms: { deluxe: 6.7, x: -1, y: "a" }, assign: { a: "deluxe", b: 3 } }));
  assert.deepEqual(p.rooms, { deluxe: 6 });
  assert.deepEqual(p.assign, { a: "deluxe" });
  assert.equal(inPool(cfg, H), true); assert.equal(inPool(cfg, "X"), false);
});

test("le tipologie con lo stesso nome (anche maiuscole diverse) formano una famiglia", () => {
  assert.equal(famKeyOf("Junior Suite"), "juniorsuite"); assert.equal(famKeyOf("junior suite"), "juniorsuite");
  const f = poolFamilies(cfg, roomTypes, units);
  assert.deepEqual(f.map((x) => [x.key, x.real, x.listings.length]), [["deluxe", 6, 2], ["juniorsuite", 1, 2], ["tripla", 1, 2]]);
  assert.equal(poolListings(cfg, roomTypes, units).some((l) => l.structureId === "X"), false); // fuori dal gruppo
});

test("senza numero indicato si propone la tipologia che ne mostra di più, da confermare", () => {
  const f = poolFamilies(cfgOf({ rooms: {} }), roomTypes, units);
  const d = f.find((x) => x.key === "deluxe")!;
  assert.equal(d.real, 7); assert.equal(d.suggested, 7); assert.equal(d.set, false);
});

test("senza prenotazioni: ogni struttura del gruppo offre le camere libere REALI della famiglia (non di più, anche se ne mostra di più)", () => {
  const r = a([]);
  assert.deepEqual([r.hD, r.hT, r.hJ, r.rD, r.rT, r.rJ], [6, 1, 1, 6, 1, 1]); // Spigolerooms mostra 3 Deluxe ma le libere del gruppo sono 6: le offre tutte
});

test("una prenotazione su una struttura riduce la disponibilità dell'altra (Deluxe)", () => {
  const r = a(bk("rD", 2));
  assert.equal(r.hD, 4); assert.equal(r.rD, 4); // le libere sono 4 per tutte e due
  const s = a(bk("hD", 4));
  assert.equal(s.hD, 2); assert.equal(s.rD, 2); // le Deluxe libere sono 2: ognuna ne vende al massimo 2
});

test("Tripla e Junior Suite si sincronizzano tra le due strutture", () => {
  const t = a(bk("hT", 1));
  assert.equal(t.hT, 0); assert.equal(t.rT, 0); assert.equal(t.hD, 6);
  const j = a(bk("rJ", 1));
  assert.equal(j.hJ, 0); assert.equal(j.rJ, 0);
});

test("Deluxe esaurite in una struttura chiudono entrambe; le altre tipologie restano", () => {
  const r = a(bk("hD", 6));
  assert.equal(r.hD, 0); assert.equal(r.rD, 0); assert.equal(r.hT, 1); assert.equal(r.rJ, 1);
});

test("annullate e giorni fuori periodo non contano; le chiusure manuali si sottraggono", () => {
  const r = a([...bk("hD", 2, day, next, "cancelled"), ...bk("hD", 1, "2026-10-12", "2026-10-13")]);
  assert.equal(r.hD, 6);
  assert.equal(a([], cfg, 2).hD, 4);
});

test("tipologia assegnata a mano a un'altra famiglia o esclusa", () => {
  // "Altra" di un'altra struttura entra nella famiglia Deluxe: ora condivide le 6 Deluxe
  const c1 = cfgOf({ structureIds: [H, R, "X"], assign: { x: "deluxe" } });
  const o1 = poolOccupancy(c1, roomTypes, units, bk("x", 2));
  assert.equal(o1.availFor("hD", day), 4); // 6 reali meno 2 prenotate nella famiglia
  // la Deluxe di Spigolerooms resa "non condivisa": torna a contare solo le sue camere
  const c2 = cfgOf({ assign: { rD: "" } });
  const o2 = poolOccupancy(c2, roomTypes, units, bk("hD", 6));
  assert.equal(o2.availFor("hD", day), 0); assert.equal(o2.availFor("rD", day), 3);
});

test("una prenotazione conta per la tipologia della camera in cui sta adesso (anche se la tipologia scelta all'inizio era un'altra)", () => {
  // La camera "hJ-0" era una Deluxe e poi è diventata Junior Suite: le prenotazioni sopra restano segnate Deluxe ma occupano la Junior.
  const bookings = [{ roomTypeId: "hD", unitId: "hJ-0", checkIn: day, checkOut: next, status: "confirmed" }];
  const o = poolOccupancy(cfg, roomTypes, units, bookings);
  assert.equal(o.availFor("hJ", day), 0); assert.equal(o.availFor("rJ", day), 0); // la Junior è occupata, in tutte e due le strutture
  assert.equal(o.availFor("hD", day), 6); // le Deluxe non perdono una camera
});

test("canSell: serve disponibilità in tutte le notti", () => {
  const o = poolOccupancy(cfg, roomTypes, units, [...bk("hD", 6, "2026-10-12", "2026-10-13"), ...bk("rJ", 1, "2026-10-12", "2026-10-13")]);
  assert.equal(o.canSell("rD", "2026-10-10", "2026-10-12"), true);
  assert.equal(o.canSell("rD", "2026-10-11", "2026-10-13"), false); // il 12 le Deluxe sono finite
  assert.equal(o.canSell("hJ", "2026-10-12", "2026-10-13"), false); // la Junior è occupata (condivisa)
  assert.equal(o.includes("x"), false);
});

test("ogni struttura del gruppo offre TUTTE le camere libere (es. 2 camere + le libere degli altri edifici); il tetto resta quello delle reali", () => {
  const C = "C";
  const rts = [...roomTypes, { id: "cD", name: "Deluxe", structureId: C }];
  const us = [...units, ...mk("cD", 2)];
  const c3 = parsePool(JSON.stringify({ enabled: true, structureIds: [H, R, C], rooms: { deluxe: 8, tripla: 1, juniorsuite: 1 } }));
  // 2 prenotazioni su H, 1 su C: libere nel gruppo = 8 - 3 = 5, per tutte e tre le strutture
  const bookings = [...bk("hD", 2), ...bk("cD", 1)];
  const o = poolOccupancy(c3, rts, us, bookings);
  assert.equal(o.availFor("cD", day), 5); // Central Perk ha 2 camere sue ma offre le 5 libere del gruppo: un gruppo di 3 camere la trova
  assert.equal(o.availFor("hD", day), 5);
  assert.equal(o.availFor("rD", day), 5);
  // tutto occupato: 0 per tutte
  const full = poolOccupancy(c3, rts, us, [...bk("hD", 6), ...bk("cD", 2)]);
  assert.equal(full.availFor("cD", day), 0); assert.equal(full.canSell("cD", day, next), false);
  // una tipologia senza omonimi nel gruppo resta limitata alle sue camere
  const solo = poolOccupancy(c3, [...rts, { id: "cS", name: "Standard", structureId: C }], [...us, ...mk("cS", 2)], [...bk("cS", 1)]);
  assert.equal(solo.availFor("cS", day), 1);
});
