import { test } from "node:test";
import assert from "node:assert/strict";
import { makeUnitAssigner } from "../src/lib/ics.ts";

const units = [
  { id: "u1", structureId: "s", roomTypeId: "t", name: "SH_1" },
  { id: "u2", structureId: "s", roomTypeId: "t", name: "SH_2" },
] as never[];
const add = () => { throw new Error("non deve creare camere"); };
const t = (x: string) => x;

test("le camere si assegnano senza sovrapposizioni anche con prenotazioni in ordine sparso", () => {
  const assign = makeUnitAssigner(units, [], "s");
  // ordine "dal più recente" come nell'export Octorate: prima una tardiva, poi due che si sovrappongono tra loro
  const a = assign("t", "2026-10-20", "2026-10-25", add, t);
  const b = assign("t", "2026-10-06", "2026-10-10", add, t);
  const c = assign("t", "2026-10-08", "2026-10-12", add, t);
  assert.ok(a && b && c, "con 2 camere e al massimo 2 prenotazioni contemporanee nessuna resta da assegnare");
  assert.notEqual(b, c); // si sovrappongono: camere diverse
});

test("check-out e check-in nello stesso giorno non si sovrappongono (stessa camera ok)", () => {
  const assign = makeUnitAssigner(units.slice(0, 1), [], "s");
  assert.equal(assign("t", "2026-10-01", "2026-10-03", add, t), "u1");
  assert.equal(assign("t", "2026-10-03", "2026-10-05", add, t), "u1");
});

test("oltre la capacità la prenotazione resta senza camera (null), non si inventa una camera", () => {
  const assign = makeUnitAssigner(units, [], "s");
  assert.ok(assign("t", "2026-10-01", "2026-10-05", add, t));
  assert.ok(assign("t", "2026-10-02", "2026-10-04", add, t));
  assert.equal(assign("t", "2026-10-03", "2026-10-04", add, t), null);
});

test("le prenotazioni già presenti occupano la camera nelle loro date", () => {
  const existing = [{ id: "b1", unitId: "u1", checkIn: "2026-10-05", checkOut: "2026-10-09", status: "confirmed" }] as never[];
  const assign = makeUnitAssigner(units, existing, "s");
  assert.equal(assign("t", "2026-10-06", "2026-10-07", add, t), "u2");
});
