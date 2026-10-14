import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { compactEuro, niceAxis } = await import("../src/lib/cassa.ts");

test("importi in forma breve", () => {
  assert.equal(compactEuro(0), "0");
  assert.equal(compactEuro(850), "850");
  assert.equal(compactEuro(1234), "1,2k");
  assert.equal(compactEuro(9999), "10,0k");
  assert.equal(compactEuro(12600), "13k");
  assert.equal(compactEuro(1500000), "1,5M");
});

test("asse Y: massimo tondo a 4 intervalli, mai sotto il valore massimo", () => {
  for (const v of [1, 7, 90, 850, 1234, 3200, 9999, 12600, 54321, 250000]) {
    const a = niceAxis(v);
    assert.ok(a.max >= v, `max ${a.max} < ${v}`);
    assert.equal(Math.round(a.step * 4 * 1000), Math.round(a.max * 1000));
  }
  assert.deepEqual(niceAxis(1234), { max: 2000, step: 500 });
  assert.deepEqual(niceAxis(54321), { max: 60000, step: 15000 });
  assert.deepEqual(niceAxis(0), { max: 4, step: 1 });
});
