import test from "node:test";
import assert from "node:assert/strict";
import { fmtDMY } from "../src/lib/dates.ts";

test("data gg.mm.aaaa", () => {
  assert.equal(fmtDMY("2026-10-29"), "29.10.2026");
  assert.equal(fmtDMY("2026-01-05"), "05.01.2026");
  assert.equal(fmtDMY("2026-10-29T10:00:00Z"), "29.10.2026");
});

test("valori non ISO restano com'erano; vuoto → stringa vuota", () => {
  assert.equal(fmtDMY("boh"), "boh");
  assert.equal(fmtDMY(""), "");
  assert.equal(fmtDMY(undefined), "");
  assert.equal(fmtDMY(null), "");
});
