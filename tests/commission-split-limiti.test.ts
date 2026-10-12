import test from "node:test";
import assert from "node:assert/strict";
import { splitCommission } from "../src/lib/commission-split.ts";

// Casi limite che tests/commission-split.test.ts non copre (elenco vuoto, camere a zero, centesimi, quote negative).
const sum = (a: (number | undefined)[]) => Math.round(a.reduce<number>((x, y) => x + (y ?? 0), 0) * 100) / 100;

test("commissione assente: resta undefined per ogni camera, anche con elenco vuoto", () => {
  assert.deepEqual(splitCommission(undefined, [100]), [undefined]);
  assert.deepEqual(splitCommission(undefined, []), []);
});

test("commissione zero: resta zero su ogni camera (non diventa undefined)", () => {
  assert.deepEqual(splitCommission(0, [100, 200]), [0, 0]);
  assert.deepEqual(splitCommission(0, [100]), [0]);
});

test("una camera a zero tra camere con prezzo: prende zero, il resto si divide tra le altre", () => {
  const r = splitCommission(30, [0, 100, 200]);
  assert.deepEqual(r, [0, 10, 20]);
});

test("la prima camera a zero e le altre pure: tutta la commissione alla sola camera con prezzo", () => {
  assert.deepEqual(splitCommission(30, [100, 0]), [30, 0]);
  assert.deepEqual(splitCommission(30, [0, 100]), [0, 30]);
});

test("totali negativi o non validi contano come zero nella proporzione", () => {
  assert.deepEqual(splitCommission(30, [-50, 100, 200]), [0, 10, 20]);
});

test("l'ultima camera riceve il resto: la somma e' sempre quella della prenotazione al centesimo", () => {
  assert.deepEqual(splitCommission(10, [1, 1, 1]), [3.33, 3.33, 3.34]);
  assert.deepEqual(splitCommission(0.01, [1, 1, 1]), [0, 0, 0.01]);
  assert.equal(sum(splitCommission(100, [33.33, 33.33, 33.34])), 100);
  assert.equal(sum(splitCommission(214.62, [311.04, 120.5, 99.99, 480])), 214.62);
});

test("due camere identiche: meta' ciascuna, anche con importo dispari", () => {
  assert.deepEqual(splitCommission(21.5, [100, 100]), [10.75, 10.75]);
  assert.deepEqual(splitCommission(0.03, [100, 100]), [0.02, 0.01]);
});

test("proprieta': la somma delle quote torna sempre alla commissione (casuale, 5000 prove)", () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < 5000; i++) {
    const n = 2 + Math.floor(rnd() * 4);
    const totals = Array.from({ length: n }, () => Math.round(rnd() * 50000) / 100);
    const comm = Math.round(rnd() * 20000) / 100;
    assert.equal(sum(splitCommission(comm, totals)), comm, JSON.stringify({ comm, totals }));
  }
});

test("nessuna quota dovrebbe essere negativa", { todo: "BUG: per arrotondamento l'ultima quota puo' uscire di -0,01 (es. commissione 2,51 su [246.25, 114.24, 475.04, 488.96, 1.46] -> ultima = -0,01); succede in ~1 caso su 70.000 prove casuali (commission-split.ts, ramo `i === roomTotals.length - 1`)" }, () => {
  const r = splitCommission(2.51, [246.25, 114.24, 475.04, 488.96, 1.46]) as number[];
  assert.ok(r.every((x) => x >= 0), JSON.stringify(r));
});
