import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { computeLedger, OPENING_CAT } = await import("../src/lib/cassa.ts");

const mv = (id: string, date: string, kind: "in" | "out", amount: number, conto = "conto-revolut", cat = "altro") => ({ id, date, kind, cat, desc: id, amount, conto });

test("estratto conto: saldo dopo ogni movimento, dal saldo di partenza", () => {
  const movs = [
    mv("vecchio", "2026-10-01", "out", 500),                       // prima della riga: nessun saldo
    mv("op", "2026-10-14", "in", 1500, "conto-revolut", OPENING_CAT),
    mv("stesso-giorno", "2026-10-14", "out", 40),                  // già compreso: non cambia il saldo
    mv("a", "2026-10-15", "in", 200.5),
    mv("b", "2026-10-16", "out", 100.25),
  ];
  const l = computeLedger(movs);
  assert.equal(l.balanceAfter.get("vecchio"), null);
  assert.equal(l.balanceAfter.get("op"), 1500);
  assert.equal(l.balanceAfter.get("stesso-giorno"), 1500);
  assert.equal(l.balanceAfter.get("a"), 1700.5);
  assert.equal(l.balanceAfter.get("b"), 1600.25);
});

test("più conti: il saldo è il totale dei conti con saldo di partenza; i conti senza non contano", () => {
  const movs = [
    mv("o1", "2026-10-14", "in", 1500, "conto-revolut", OPENING_CAT),
    mv("o2", "2026-10-14", "in", 500, "conto-baps", OPENING_CAT),
    mv("o3", "2026-10-14", "in", 1000, "contanti", OPENING_CAT),
    mv("x", "2026-10-15", "out", 100, "conto-baps"),
    mv("y", "2026-10-16", "in", 30, "carta"),                       // conto senza saldo di partenza
  ];
  const l = computeLedger(movs);
  assert.equal(l.balanceAfter.get("o3"), 3000);
  assert.equal(l.balanceAfter.get("x"), 2900);
  assert.equal(l.balanceAfter.get("y"), 2900);
});

test("un saldo di partenza più recente sostituisce il precedente; ordine stabile nello stesso giorno", () => {
  const movs = [
    mv("o1", "2026-10-01", "in", 100, "conto-revolut", OPENING_CAT),
    mv("p", "2026-10-05", "in", 10),
    mv("o2", "2026-10-10", "in", 1000, "conto-revolut", OPENING_CAT),
    mv("q", "2026-10-12", "out", 50),
    mv("r", "2026-10-12", "in", 20),
  ];
  const l = computeLedger(movs);
  assert.equal(l.balanceAfter.get("o1"), null); // sostituito da uno più recente: nessun effetto
  assert.equal(l.balanceAfter.get("p"), null);
  assert.equal(l.balanceAfter.get("o2"), 1000);
  assert.equal(l.balanceAfter.get("q"), 950);
  assert.equal(l.balanceAfter.get("r"), 970);
  assert.ok((l.order.get("q") ?? 0) < (l.order.get("r") ?? 0));
});

test("senza alcun saldo di partenza nessun movimento ha un saldo", () => {
  const l = computeLedger([mv("a", "2026-10-15", "in", 10)]);
  assert.equal(l.balanceAfter.get("a"), null);
});
