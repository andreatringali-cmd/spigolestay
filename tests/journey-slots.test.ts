import { test } from "node:test";
import assert from "node:assert/strict";
import { slotsOf, SLOT_KEYS } from "../src/lib/journey-slots.ts";

const st = (key: string, state: "done" | "todo" | "late" | "na", detail = "d") => ({ key, label: key, state, detail });

test("senza percorso: 8 slot ordinati, tutti non applicabili", () => {
  for (const input of [null, undefined, []]) {
    const s = slotsOf(input as never);
    assert.deepEqual(s.map((x) => x.key), [...SLOT_KEYS]);
    assert.ok(s.every((x) => x.state === "na" && !x.step));
  }
  assert.equal(slotsOf(null, "Prenotazione annullata")[0].detail, "Prenotazione annullata");
});

test("l'ordine è quello della dettagliata, qualunque sia l'ordine d'ingresso", () => {
  assert.deepEqual([...SLOT_KEYS], ["checkin", "pay", "guide", "alloggiati", "istat", "tax", "invoice", "checkout"]);
  const steps = [st("checkout", "todo"), st("invoice", "done"), st("checkin", "late"), st("pay", "todo")];
  const s = slotsOf(steps as never);
  assert.equal(s.length, 8);
  assert.deepEqual(s.map((x) => x.key), [...SLOT_KEYS]);
  assert.equal(s[0].state, "late");
  assert.equal(s[1].state, "todo");
  assert.equal(s[6].state, "done");
  assert.equal(s[7].state, "todo");
});

test("passaggi mancanti (es. tassa, guida) restano come slot non applicabili al loro posto", () => {
  const steps = [st("checkin", "done"), st("pay", "done"), st("alloggiati", "todo"), st("istat", "todo"), st("invoice", "todo"), st("checkout", "na")];
  const s = slotsOf(steps as never);
  assert.equal(s.length, 8);
  assert.equal(s[2].key, "guide");
  assert.equal(s[2].state, "na");
  assert.equal(s[5].key, "tax");
  assert.equal(s[5].state, "na");
  assert.equal(s[7].state, "na");
});

test("la recensione (e chiavi sconosciute) restano fuori dagli 8", () => {
  const s = slotsOf([st("review", "todo"), st("checkin", "done"), st("boh", "late")] as never);
  assert.equal(s.length, 8);
  assert.ok(!s.some((x) => (x.key as string) === "review" || (x.key as string) === "boh"));
});

test("lo stato e il dettaglio del passaggio reale sono conservati", () => {
  const s = slotsOf([st("checkin", "todo", "L'ospite non ha ancora compilato")] as never);
  assert.equal(s[0].detail, "L'ospite non ha ancora compilato");
  assert.equal(s[0].step?.key, "checkin");
});
