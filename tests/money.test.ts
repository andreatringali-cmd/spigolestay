import { test } from "node:test";
import assert from "node:assert/strict";
import { roundCents, sumCents } from "../src/lib/money.ts";

test("roundCents: arrotonda a 2 decimali", () => {
  assert.equal(roundCents(0.1 + 0.2), 0.3);
  assert.equal(roundCents(1.005), 1.01);
  assert.equal(roundCents(2.675), 2.68);
  assert.equal(roundCents(10), 10);
  assert.equal(roundCents(33.333333), 33.33);
  assert.equal(roundCents(33.335), 33.34);
});

test("roundCents: negativi simmetrici, niente -0, valori non finiti", () => {
  assert.equal(roundCents(-1.005), -1.01);
  assert.equal(roundCents(-0.001), 0);
  assert.ok(Object.is(roundCents(-0.001), 0));
  assert.equal(roundCents(NaN), 0);
  assert.equal(roundCents(Infinity), 0);
});

test("sumCents: somma senza deriva di virgola mobile", () => {
  assert.equal(sumCents([0.1, 0.2]), 0.3);
  assert.equal(sumCents(Array(10).fill(0.1)), 1);
  assert.equal(sumCents([19.99, 5.01, 0.1, 0.2]), 25.3);
  assert.equal(sumCents([]), 0);
});

test("sumCents: ignora valori non numerici e accetta negativi", () => {
  assert.equal(sumCents([10, undefined, null, NaN, 5.5]), 15.5);
  assert.equal(sumCents([100, -33.33]), 66.67);
  assert.equal(sumCents(new Set([1.1, 2.2])), 3.3);
});
