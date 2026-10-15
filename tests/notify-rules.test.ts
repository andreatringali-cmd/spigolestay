import test from "node:test";
import assert from "node:assert/strict";
import { campoCambiato, modificaMeritaEmail, spostamentoMeritaEmail } from "../src/lib/notify-rules.ts";

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

test("campoCambiato: vuoto, null e 0 sono uguali; decimali al centesimo; testi senza spazi", () => {
  assert.equal(campoCambiato(undefined, 0), false);
  assert.equal(campoCambiato(null, undefined), false);
  assert.equal(campoCambiato("", undefined), false);
  assert.equal(campoCambiato(99, 99.001), false);
  assert.equal(campoCambiato(99, 99.01), true);
  assert.equal(campoCambiato(0, 80), true);
  assert.equal(campoCambiato(" a ", "a"), false);
  assert.equal(campoCambiato("confirmed", "cancelled"), true);
  assert.equal(campoCambiato("g1", "g2"), true);
});
