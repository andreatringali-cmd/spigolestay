import test from "node:test";
import assert from "node:assert/strict";
import { onSolid, whiteContrastOnHex } from "../src/lib/on-solid.ts";

test("onSolid: token di stato e accento", () => {
  assert.equal(onSolid("var(--err)"), "text-on-err");
  assert.equal(onSolid("var(--warn)"), "text-on-warn");
  assert.equal(onSolid("var(--ok)"), "text-on-ok");
  assert.equal(onSolid("var(--dim)"), "text-on-focus");
});
test("onSolid: esadecimale scuro resta bianco, chiaro o medio passa al quasi-nero", () => {
  assert.equal(onSolid("#1A1A1A"), "text-white");
  assert.equal(onSolid("#065F73"), "text-white");
  assert.equal(onSolid("#BE5D38"), "text-[#0F1115]"); // bianco 4,4:1
  assert.equal(onSolid("#EAB308"), "text-[#0F1115]"); // giallo
  assert.equal(onSolid("#fff"), "text-[#0F1115]");
});
test("onSolid: formati non esadecimali e valori vuoti restano bianchi", () => {
  assert.equal(onSolid("rgb(10 10 10)"), "text-white");
  assert.equal(onSolid(undefined), "text-white");
  assert.equal(onSolid(""), "text-white");
});
test("whiteContrastOnHex: valori noti", () => {
  assert.ok(Math.abs((whiteContrastOnHex("#000000") ?? 0) - 21) < 0.01);
  assert.ok(Math.abs((whiteContrastOnHex("#FFFFFF") ?? 0) - 1) < 0.01);
  assert.equal(whiteContrastOnHex("blu"), null);
});
