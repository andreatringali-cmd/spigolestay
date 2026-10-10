import test from "node:test";
import assert from "node:assert/strict";
import { overlapLosers } from "../src/lib/overlaps.ts";

const b = (id: string, unitId: string | null, checkIn: string, checkOut: string, extra: Record<string, unknown> = {}) => ({ id, unitId, checkIn, checkOut, status: "confirmed", ...extra });

test("nessuna sovrapposizione: non si sposta niente (anche con cambio in giornata)", () => {
  assert.deepEqual(overlapLosers([b("a", "u1", "2026-07-01", "2026-07-03"), b("b", "u1", "2026-07-03", "2026-07-05"), b("c", "u2", "2026-07-01", "2026-07-05")]), []);
});

test("resta la prima che arriva, l'altra va in Da assegnare", () => {
  assert.deepEqual(overlapLosers([b("b", "u1", "2026-07-02", "2026-07-04"), b("a", "u1", "2026-07-01", "2026-07-03")]), ["b"]);
});

test("tre prenotazioni a catena: si tengono quelle che non si toccano tra loro", () => {
  const l = overlapLosers([b("a", "u1", "2026-07-01", "2026-07-05"), b("b", "u1", "2026-07-03", "2026-07-07"), b("c", "u1", "2026-07-05", "2026-07-08")]);
  assert.deepEqual(l, ["b"]);
});

test("annullate, senza camera e fuori ambito non contano; i blocchi hanno la precedenza", () => {
  assert.deepEqual(overlapLosers([b("a", "u1", "2026-07-01", "2026-07-05"), b("x", "u1", "2026-07-02", "2026-07-04", { status: "cancelled" }), b("n", null, "2026-07-02", "2026-07-04")]), []);
  assert.deepEqual(overlapLosers([b("a", "u1", "2026-07-01", "2026-07-05"), b("blk", "u1", "2026-07-03", "2026-07-04", { channel: "blocked" })]), ["a"]);
  assert.deepEqual(overlapLosers([b("a", "u1", "2026-07-01", "2026-07-05"), b("b", "u1", "2026-07-02", "2026-07-04")], (x) => x.id === "a"), []);
});

import { planOverlapFix } from "../src/lib/overlaps.ts";

test("planOverlapFix: prima un'altra camera libera (stessa tipologia, poi un'altra), poi Da assegnare", () => {
  const roomTypes = [{ id: "S", structureId: "X" }, { id: "D", structureId: "X" }, { id: "Z", structureId: "Y" }];
  const units = [{ id: "s1", roomTypeId: "S" }, { id: "s2", roomTypeId: "S" }, { id: "d1", roomTypeId: "D" }, { id: "z1", roomTypeId: "Z" }];
  const bk = (id: string, unitId: string, ci: string, co: string, roomTypeId = "S") => ({ id, unitId, checkIn: ci, checkOut: co, status: "confirmed", roomTypeId, structureId: "X" });
  // s1 ha due prenotazioni insieme: la seconda va in s2 (stessa tipologia, libera)
  let r = planOverlapFix([bk("a", "s1", "2026-07-01", "2026-07-05"), bk("b", "s1", "2026-07-02", "2026-07-04")], units, roomTypes);
  assert.deepEqual(r, { moves: [{ id: "b", unitId: "s2" }], unassign: [] });
  // s2 occupata: va in d1 (altra tipologia, stessa struttura); mai in z1 (altra struttura)
  r = planOverlapFix([bk("a", "s1", "2026-07-01", "2026-07-05"), bk("b", "s1", "2026-07-02", "2026-07-04"), bk("c", "s2", "2026-07-01", "2026-07-05")], units, roomTypes);
  assert.deepEqual(r, { moves: [{ id: "b", unitId: "d1" }], unassign: [] });
  // tutto pieno: Da assegnare
  r = planOverlapFix([bk("a", "s1", "2026-07-01", "2026-07-05"), bk("b", "s1", "2026-07-02", "2026-07-04"), bk("c", "s2", "2026-07-01", "2026-07-05"), bk("d", "d1", "2026-07-01", "2026-07-05")], units, roomTypes);
  assert.deepEqual(r, { moves: [], unassign: ["b"] });
});
