import { test } from "node:test";
import assert from "node:assert/strict";
import { recordCompare, flushCompareStats, _setCompareSender, type CompareRow } from "../src/lib/compare-stats.ts";

test("contatori del confronto: le differenze partono subito, i «tutto uguale» si accumulano", async () => {
  const sent: CompareRow[][] = [];
  _setCompareSender(async (rows) => { sent.push(rows); });
  recordCompare("health", "ok");           // il primo ok parte (nessun invio precedente)
  await flushCompareStats();
  recordCompare("health", "ok"); recordCompare("health", "ok"); recordCompare("calendar", "ok"); // dentro i 30 s: restano in memoria
  assert.equal(sent.length, 1);
  recordCompare("calendar", "diff", { only_block: 2 }); // una differenza: invio subito, con tutto quello accumulato
  await flushCompareStats();
  assert.equal(sent.length, 2);
  const rows = Object.fromEntries(sent[1].map((r) => [r.label, r]));
  assert.equal(rows.health.ok, 2);
  assert.equal(rows.calendar.ok, 1); assert.equal(rows.calendar.diff, 1);
  assert.deepEqual(rows.calendar.detail, { only_block: 2 });
  _setCompareSender(null);
});
test("contatori del confronto: errore e ripiego contano come errori; un invio fallito non rompe nulla", async () => {
  _setCompareSender(async () => { throw new Error("rete"); });
  recordCompare("x", "error", { message: "boom" });
  recordCompare("x", "fallback_to_block");
  await flushCompareStats(); // non lancia
  _setCompareSender(null);
  assert.ok(true);
});
