import test from "node:test";
import assert from "node:assert/strict";
import { keyActivate } from "../src/lib/a11y.ts";

function ev(key: string, same = true) {
  const el = {};
  let prevented = false;
  return { e: { key, target: same ? el : {}, currentTarget: el, preventDefault: () => { prevented = true; } }, prevented: () => prevented };
}

test("keyActivate: senza azione non aggiunge nulla", () => {
  assert.deepEqual(keyActivate(undefined), {});
  assert.deepEqual(keyActivate(null), {});
});

test("keyActivate: tabIndex 0 e Invio/Spazio eseguono l'azione", () => {
  let n = 0;
  const p = keyActivate(() => { n++; });
  assert.equal(p.tabIndex, 0);
  const a = ev("Enter"); p.onKeyDown!(a.e); assert.equal(n, 1); assert.ok(a.prevented());
  const b = ev(" "); p.onKeyDown!(b.e); assert.equal(n, 2);
});

test("keyActivate: altri tasti e tasti premuti su un controllo interno sono ignorati", () => {
  let n = 0;
  const p = keyActivate(() => { n++; });
  p.onKeyDown!(ev("a").e);
  p.onKeyDown!(ev("Tab").e);
  p.onKeyDown!(ev("Enter", false).e);
  assert.equal(n, 0);
});

test("keyActivate: role opzionale", () => {
  assert.equal(keyActivate(() => {}).role, undefined);
  assert.equal(keyActivate(() => {}, { role: "button" }).role, "button");
});
