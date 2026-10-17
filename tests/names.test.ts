import test from "node:test";
import assert from "node:assert/strict";
import { titleCaseName } from "../src/lib/names.ts";

test("titleCaseName: solo l'iniziale maiuscola, anche con apostrofi, trattini e accenti", () => {
  assert.equal(titleCaseName("MICHIEL VAN HERTEN"), "Michiel Van Herten");
  assert.equal(titleCaseName("PAPOUTSAKIS IOANNIS"), "Papoutsakis Ioannis");
  assert.equal(titleCaseName("raffaella fantoni"), "Raffaella Fantoni");
  assert.equal(titleCaseName("D'ANGELO jean-pierre"), "D'Angelo Jean-Pierre");
  assert.equal(titleCaseName("ŁUKASZ  nowak"), "Łukasz Nowak");
  assert.equal(titleCaseName("  "), "");
  assert.equal(titleCaseName(undefined), "");
});
