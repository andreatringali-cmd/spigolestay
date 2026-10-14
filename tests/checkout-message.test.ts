import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { checkoutMessage } = await import("../src/lib/guest-messages.ts");
const { stepOpensModal } = await import("../src/lib/booking-journey.ts");

test("promemoria di check-out: data, orario e struttura in tutte le lingue", () => {
  for (const lang of ["it", "en", "fr", "de", "es"] as const) {
    const m = checkoutMessage(lang, { date: "15/10", time: "10:30", structure: "Spigolehouse" });
    assert.ok(m.includes("15/10"), lang);
    assert.ok(m.includes("10:30"), lang);
    assert.ok(m.includes("Spigolehouse"), lang);
    assert.ok(!/channex/i.test(m), lang);
  }
});

test("senza orario non si inventa un'ora", () => {
  const m = checkoutMessage("it", { date: "15/10", structure: "Spigolehouse" });
  assert.ok(!/entro le/.test(m));
});

test("il clic sul check-out apre la finestra di invio anche in anticipo, ma non dopo la partenza", () => {
  assert.equal(stepOpensModal({ key: "checkout", state: "na" }), true);
  assert.equal(stepOpensModal({ key: "checkout", state: "todo" }), true);
  assert.equal(stepOpensModal({ key: "checkout", state: "done" }), false);
  assert.equal(stepOpensModal({ key: "guide", state: "na" }), false);
  assert.equal(stepOpensModal({ key: "guide", state: "late" }), true);
});
