import test from "node:test";
import assert from "node:assert/strict";
import { modificaMeritaEmail, spostamentoMeritaEmail } from "../src/lib/notify-rules.ts";

test("solo cambio di camera: nessuna email di modifica", () => {
  assert.equal(modificaMeritaEmail(["unitId"]), false);
  assert.equal(modificaMeritaEmail(["unitId", "roomTypeId"]), false);
  assert.equal(modificaMeritaEmail([]), false);
});

test("tutto il resto: email di modifica", () => {
  for (const f of ["checkIn", "checkOut", "adults", "children", "total", "channel", "status", "guestId"]) assert.equal(modificaMeritaEmail([f]), true, f);
  assert.equal(modificaMeritaEmail(["unitId", "checkIn"]), true, "camera + date");
  assert.equal(modificaMeritaEmail(["roomTypeId", "total"]), true, "camera + tariffa");
});

test("spostamento nel calendario: stesse date e struttura = niente email; date o struttura diverse = email", () => {
  const a = { checkIn: "2026-10-12", checkOut: "2026-10-15" };
  assert.equal(spostamentoMeritaEmail(a, { ...a }, false), false);
  assert.equal(spostamentoMeritaEmail(a, { ...a, checkOut: "2026-10-16" }, false), true);
  assert.equal(spostamentoMeritaEmail(a, { checkIn: "2026-10-13", checkOut: "2026-10-16" }, false), true);
  assert.equal(spostamentoMeritaEmail(a, { ...a }, true), true);
});
