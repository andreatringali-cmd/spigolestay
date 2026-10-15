import test from "node:test";
import assert from "node:assert/strict";
import { parseDecimalIT, formatDecimalIT, roundDecimals, NUM_TYPING_RE } from "../src/lib/num-it.ts";

test("parseDecimalIT: virgola e punto come separatore decimale (il caso 75,70 euro)", () => {
  assert.equal(parseDecimalIT("75,70"), 75.7);
  assert.equal(parseDecimalIT("75.70"), 75.7);
  assert.equal(parseDecimalIT("75,7"), 75.7);
  assert.equal(parseDecimalIT("75"), 75);
  assert.equal(parseDecimalIT("0,5"), 0.5);
  assert.equal(parseDecimalIT(",5"), 0.5);
  assert.equal(parseDecimalIT("12.5"), 12.5);
  assert.equal(parseDecimalIT("0.125"), 0.125);
});

test("parseDecimalIT: digitazione intermedia ('75,' '75.') non diventa 0", () => {
  assert.equal(parseDecimalIT("75,"), 75);
  assert.equal(parseDecimalIT("75."), 75);
  assert.equal(parseDecimalIT("7"), 7);
});

test("parseDecimalIT: migliaia all'italiana e all'inglese", () => {
  assert.equal(parseDecimalIT("1.234,50"), 1234.5);
  assert.equal(parseDecimalIT("1,234.50"), 1234.5);
  assert.equal(parseDecimalIT("1.234"), 1234);
  assert.equal(parseDecimalIT("1.234.567"), 1234567);
  assert.equal(parseDecimalIT("1,234,567"), 1234567);
  assert.equal(parseDecimalIT("1234,5"), 1234.5);
});

test("parseDecimalIT: simboli e spazi ignorati, vuoto o non valido = null", () => {
  assert.equal(parseDecimalIT("€ 75,7"), 75.7);
  assert.equal(parseDecimalIT(" 75 , 7 "), 75.7);
  assert.equal(parseDecimalIT(""), null);
  assert.equal(parseDecimalIT("   "), null);
  assert.equal(parseDecimalIT("-"), null);
  assert.equal(parseDecimalIT(","), null);
  assert.equal(parseDecimalIT("abc"), null);
  assert.equal(parseDecimalIT(undefined), null);
  assert.equal(parseDecimalIT(null), null);
  assert.equal(parseDecimalIT("1,2.3,4"), null);
});

test("parseDecimalIT: numeri passano invariati, negativi e zero", () => {
  assert.equal(parseDecimalIT(75.7), 75.7);
  assert.equal(parseDecimalIT(NaN), null);
  assert.equal(parseDecimalIT("-5,5"), -5.5);
  assert.ok(Object.is(parseDecimalIT("-0"), 0));
  assert.equal(parseDecimalIT("0"), 0);
});

test("formatDecimalIT e roundDecimals: virgola italiana, interi senza decimali", () => {
  assert.equal(formatDecimalIT(75), "75");
  assert.equal(formatDecimalIT(75.7), "75,70");
  assert.equal(formatDecimalIT(1234.5), "1234,50");
  assert.equal(formatDecimalIT(0), "0");
  assert.equal(formatDecimalIT(null), "");
  assert.equal(formatDecimalIT(undefined), "");
  assert.equal(formatDecimalIT(12.5, 1), "12,5");
  assert.equal(roundDecimals(1.005), 1.01);
  assert.equal(roundDecimals(75.705), 75.71);
  assert.equal(roundDecimals(-0.001), 0);
  assert.equal(parseDecimalIT(formatDecimalIT(75.7)), 75.7);
});

test("NUM_TYPING_RE: cifre, virgola, punto e meno; niente lettere", () => {
  for (const ok of ["", "75", "75,", "75,7", "1.234,50", "-3", "7 5"]) assert.ok(NUM_TYPING_RE.test(ok), ok);
  for (const bad of ["7a", "€5", "1e3", "5%"]) assert.ok(!NUM_TYPING_RE.test(bad), bad);
});
