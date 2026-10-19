import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { realGuestRequests } = await import("../src/lib/guest-requests.ts");

test("note Expedia solo tecniche: nessuna richiesta dell'ospite", () => {
  const n = "Accelerator Fee: €18.78\nCollect Amount: €154.92\nOTA Commission: €28.14\nPayment Collect: OTA collect\nPayment Instruction: Expedia collects payment from traveler: Hotel charges virtual card.\nSmoking Preferences: NONSMOKING\nSource: Expedia Affiliate Network";
  assert.equal(realGuestRequests(n), undefined);
});
test("note Booking: via i banner e le righe tecniche, resta la richiesta scritta dall'ospite", () => {
  const n = "** THIS RESERVATION HAS BEEN PRE-PAID **\nBOOKING NOTE : Payment charge is EUR 3.3834\nMeal Plan: La colazione è inclusa.\nSmoking Preference: Non-Smoking\nPayment Collect: OTA collect\nOTA Commission: 51.88\nVorremmo un letto in più per il bambino, arriviamo tardi.";
  assert.equal(realGuestRequests(n), "Vorremmo un letto in più per il bambino, arriviamo tardi.");
});
test("richiesta normale e valori vuoti", () => {
  assert.equal(realGuestRequests("Arrivo alle 22, culla per favore"), "Arrivo alle 22, culla per favore");
  assert.equal(realGuestRequests(""), undefined);
  assert.equal(realGuestRequests(undefined), undefined);
});
