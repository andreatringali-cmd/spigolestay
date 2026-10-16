import test from "node:test";
import assert from "node:assert/strict";
import { mergeKeyedList } from "../src/lib/list-merge.ts";

const L = (...keys: string[]) => JSON.stringify(keys.map((k) => ({ key: k, label: k })));
const keys = (raw: string | null) => (raw ? (JSON.parse(raw) as { key: string }[]).map((e) => e.key) : null);

test("voce creata su un altro dispositivo: non si perde se questo browser ha la lista vecchia", () => {
  // base = A,B ; server ha aggiunto F ; il locale (vecchio) ha aggiunto R
  assert.deepEqual(keys(mergeKeyedList(L("A", "B", "R"), L("A", "B", "F"), L("A", "B"))), ["A", "B", "R", "F"]);
});

test("voce cancellata qui resta cancellata (era nella base)", () => {
  assert.deepEqual(keys(mergeKeyedList(L("A"), L("A", "B"), L("A", "B"))), ["A"]);
});

test("stessa voce modificata sul server e non qui: si adotta il server; modificata qui: vince il locale", () => {
  const base = JSON.stringify([{ key: "A", label: "uno" }]);
  const server = JSON.stringify([{ key: "A", label: "due" }]);
  assert.equal((JSON.parse(mergeKeyedList(base, server, base) as string) as { label: string }[])[0].label, "due");
  const local = JSON.stringify([{ key: "A", label: "locale" }]);
  assert.equal((JSON.parse(mergeKeyedList(local, server, base) as string) as { label: string }[])[0].label, "locale");
});

test("testi non validi o base mancante: nessun danno", () => {
  assert.equal(mergeKeyedList("non json", L("A"), L("A")), null);
  assert.equal(mergeKeyedList(L("A"), undefined, L("A")), null);
  assert.deepEqual(keys(mergeKeyedList(L("A"), L("A", "B"), undefined)), ["A", "B"]); // senza base: le voci del server si tengono
});
