import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { refineGroups, mergePatch, planMerges } = await import("../src/app/(app)/ospiti/_merge.ts");
const { promoRecipientEmail } = await import("../src/lib/promos.ts");

const g = (id: string, o: Record<string, unknown> = {}) => ({ id, fullName: id, ...o }) as never;

test("stesso telefono ma nomi diversi: NON si uniscono", () => {
  const a = g("a", { fullName: "Agenzia Viaggi Sole", phone: "+39 333 1234567" });
  const b = g("b", { fullName: "Giulia Bianchi", phone: "333 1234567" });
  assert.deepEqual(refineGroups([[a, b]]), []);
});

test("stesso telefono e nome compatibile (ordine o parte del nome): si uniscono", () => {
  const a = g("a", { fullName: "Mario Rossi", phone: "+39 333 1234567" });
  const b = g("b", { fullName: "Rossi Mario", phone: "3331234567" });
  const c = g("c", { fullName: "Rossi", phone: "0039 333 1234567" });
  const out = refineGroups([[a, b, c]]);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 3);
});

test("stessa email reale: si uniscono anche con nomi scritti diversi; stesso nome ma paesi diversi: no", () => {
  assert.equal(refineGroups([[g("a", { fullName: "J. Smith", email: "js@gmail.com" }), g("b", { fullName: "John Smith", email: "JS@gmail.com" })]]).length, 1);
  assert.deepEqual(refineGroups([[g("a", { fullName: "Anna Muller", country: "DE" }), g("b", { fullName: "Anna Muller", country: "AT" })]]), []);
});

test("mergePatch: completa TUTTI i campi mancanti, tag in unione, vip/consenso in OR, note accodate", () => {
  const keeper = g("k", { fullName: "Mario Rossi", email: "m@x.it", tags: ["Business"], notes: "Allergico ai gatti" }) as never;
  const other = g("o", {
    fullName: "Mario Rossi", phone: "+39 333 1", sex: "M", language: "it", province: "SR", streetNumber: "4", docPhotoFront: "media:xenora-private:1", docPhotoBack: "media:xenora-private:2",
    tags: ["Business", "Famiglia"], vip: true, marketingConsent: true, notes: "Arriva tardi", preferences: "Camera silenziosa",
  }) as never;
  const p = mergePatch(keeper, [other]) as Record<string, unknown>;
  for (const k of ["phone", "sex", "language", "province", "streetNumber", "docPhotoFront", "docPhotoBack"]) assert.ok(p[k], k);
  assert.deepEqual(p.tags, ["Business", "Famiglia"]);
  assert.equal(p.vip, true);
  assert.equal(p.marketingConsent, true);
  assert.equal(p.notes, "Allergico ai gatti\nArriva tardi");
  assert.equal(p.preferences, "Camera silenziosa");
  assert.equal(p.email, undefined); // già presente: non si tocca
});

test("planMerges: resta la scheda con più prenotazioni", () => {
  const a = g("a", { fullName: "Mario Rossi" }), b = g("b", { fullName: "Mario Rossi", phone: "+39 333 1234567" });
  const [plan] = planMerges([[a, b]], new Map([["a", 1], ["b", 4]]));
  assert.equal(plan.keepId, "b");
  assert.deepEqual(plan.dropIds, ["a"]);
});

test("promo: solo email vere con consenso marketing o newsletter", () => {
  assert.equal(promoRecipientEmail({ email: "x@gmail.com" }), "");
  assert.equal(promoRecipientEmail({ email: "X@gmail.com", marketingConsent: true }), "x@gmail.com");
  assert.equal(promoRecipientEmail({ email: "x@gmail.com", tags: ["newsletter"] }), "x@gmail.com");
  assert.equal(promoRecipientEmail({ email: "abc@guest.booking.com", marketingConsent: true }), "");
  assert.equal(promoRecipientEmail({ marketingConsent: true }), "");
});
