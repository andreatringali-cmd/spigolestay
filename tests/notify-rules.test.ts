import test from "node:test";
import assert from "node:assert/strict";
import { campoCambiato, modificaMeritaEmail, spostamentoMeritaEmail } from "../src/lib/notify-rules.ts";

test("cambio della sola camera: nessuna email di modifica", () => {
  assert.equal(modificaMeritaEmail(["unitId"]), false);
  assert.equal(modificaMeritaEmail(["unitId", "roomTypeId"]), false);
  assert.equal(modificaMeritaEmail(["unitId", "checkIn"]), true);
});

test("spostamento nel calendario: email solo se cambiano date o struttura", () => {
  const d = { checkIn: "2026-10-20", checkOut: "2026-10-22" };
  assert.equal(spostamentoMeritaEmail(d, d, false), false);
  assert.equal(spostamentoMeritaEmail(d, { ...d, checkOut: "2026-10-23" }, false), true);
  assert.equal(spostamentoMeritaEmail(d, d, true), true);
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
