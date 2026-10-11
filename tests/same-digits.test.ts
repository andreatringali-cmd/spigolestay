import test from "node:test";
import assert from "node:assert/strict";
import { onlyDigits, sameDigits } from "../src/lib/same-digits.ts";

test("onlyDigits toglie tutto tranne le cifre (e non le lettere D)", () => {
  assert.equal(onlyDigits("+39 347 382 4353"), "393473824353");
  assert.equal(onlyDigits("D1D2"), "12");
  assert.equal(onlyDigits(undefined), "");
});

test("sameDigits: stesso numero scritto in modi diversi", () => {
  assert.equal(sameDigits("+39 347 382 4353", "39 3473824353"), true);
  assert.equal(sameDigits("347 382 4353", "+39 347 382 4353"), false); // manca il prefisso: l'avviso deve comparire
});
