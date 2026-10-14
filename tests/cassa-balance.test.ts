import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { computeBalances, OPENING_CAT } = await import("../src/lib/cassa.ts");

const mv = (id: string, date: string, kind: "in" | "out", amount: number, conto = "banca", cat = "altro") => ({ id, date, kind, cat, desc: id, amount, conto });
const TODAY = "2026-10-20";

test("senza saldo di partenza: somma di tutti i movimenti, come prima", () => {
  const b = computeBalances([mv("a", "2026-01-01", "in", 100), mv("b", "2026-02-01", "out", 30)], TODAY, ["banca", "contanti"]);
  assert.equal(b.banca.saldo, 70);
  assert.equal(b.banca.since, undefined);
  assert.equal(b.contanti.saldo, 0);
});

test("con saldo di partenza: importo + solo i movimenti dei giorni dopo, fino a oggi", () => {
  const movs = [
    mv("vecchio", "2026-05-01", "out", 500),          // prima della riga: ignorato
    mv("aprt", "2026-10-14", "in", 1234.56, "banca", OPENING_CAT),
    mv("stesso-giorno", "2026-10-14", "out", 40),      // già compreso nell'importo scritto
    mv("dopo-in", "2026-10-15", "in", 200.5),
    mv("dopo-out", "2026-10-16", "out", 100.25),
    mv("futuro", "2026-11-01", "in", 999),             // non ancora avvenuto
  ];
  const b = computeBalances(movs, TODAY, ["banca"]);
  assert.equal(b.banca.saldo, 1334.81); // 1234,56 + 200,50 − 100,25
  assert.equal(b.banca.since, "2026-10-14");
  assert.equal(b.banca.start, 1234.56);
});

test("saldo di partenza negativo (scoperto) e conti indipendenti", () => {
  const movs = [mv("o1", "2026-10-14", "out", 300, "banca", OPENING_CAT), mv("c1", "2026-10-15", "in", 50, "contanti"), mv("b1", "2026-10-16", "in", 100)];
  const b = computeBalances(movs, TODAY, ["banca", "contanti"]);
  assert.equal(b.banca.saldo, -200);
  assert.equal(b.contanti.saldo, 50); // il contante non ha una riga: somma di tutto
});

test("più saldi di partenza sullo stesso conto: vale il più recente", () => {
  const movs = [mv("o1", "2026-10-01", "in", 100, "banca", OPENING_CAT), mv("o2", "2026-10-10", "in", 500, "banca", OPENING_CAT), mv("x", "2026-10-12", "out", 20)];
  assert.equal(computeBalances(movs, TODAY, ["banca"]).banca.saldo, 480);
});
