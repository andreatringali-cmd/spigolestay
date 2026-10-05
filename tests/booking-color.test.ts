import { test } from "node:test";
import assert from "node:assert/strict";
import { isHexColor, textOn, BOOKING_COLORS } from "../src/lib/booking-color.ts";

test("isHexColor accetta solo #rrggbb", () => {
  assert.equal(isHexColor("#2563eb"), true);
  assert.equal(isHexColor("#FFF"), false);
  assert.equal(isHexColor("red"), false);
  assert.equal(isHexColor("url(javascript:1)"), false);
  assert.equal(isHexColor(undefined), false);
  assert.equal(isHexColor(""), false);
});

test("textOn: bianco su scuro, quasi nero su chiaro", () => {
  assert.equal(textOn("#000000"), "#ffffff");
  assert.equal(textOn("#2563eb"), "#ffffff");
  assert.equal(textOn("#ffffff"), "#1a1a1a");
  assert.equal(textOn("#fde68a"), "#1a1a1a");
});

test("tutti i colori proposti sono validi", () => {
  for (const c of BOOKING_COLORS) assert.equal(isHexColor(c), true, c);
});
