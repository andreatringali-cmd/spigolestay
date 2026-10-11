import test from "node:test";
import assert from "node:assert/strict";
import { splitCommission } from "../src/lib/commission-split.ts";

const sum = (a: (number | undefined)[]) => Math.round(a.reduce<number>((x, y) => x + (y ?? 0), 0) * 100) / 100;

test("una sola camera: la commissione resta intera", () => {
  assert.deepEqual(splitCommission(214.62, [311.04]), [214.62]);
});

test("tre camere uguali: si divide in parti uguali, la somma è quella della prenotazione (non il triplo)", () => {
  const r = splitCommission(214.62, [311.04, 311.04, 311.04]);
  assert.deepEqual(r, [71.54, 71.54, 71.54]);
  assert.equal(sum(r), 214.62);
});

test("camere con prezzi diversi: in proporzione, e il resto all'ultima chiude al centesimo", () => {
  const r = splitCommission(100, [100, 200, 300]);
  assert.equal(sum(r), 100);
  assert.ok((r[0] as number) < (r[1] as number) && (r[1] as number) < (r[2] as number));
  const odd = splitCommission(10, [1, 1, 1]);
  assert.equal(sum(odd), 10);
});

test("senza commissione o senza prezzi", () => {
  assert.deepEqual(splitCommission(undefined, [10, 10]), [undefined, undefined]);
  const r = splitCommission(30, [0, 0, 0]);
  assert.equal(sum(r), 30);
});
