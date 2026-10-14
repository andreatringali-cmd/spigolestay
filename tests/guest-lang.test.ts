import test from "node:test";
import assert from "node:assert/strict";
import { guestLangOf } from "../src/lib/guest-lang.ts";

test("lingua impostata a mano: vince su tutto", () => {
  assert.equal(guestLangOf({ language: "en", country: "IT" }), "en");
  assert.equal(guestLangOf({ language: "de-AT", country: "FR" }), "de");
  assert.equal(guestLangOf({ lang: "fr" }), "fr");
});

test("senza lingua: dal Paese (codice delle OTA)", () => {
  assert.equal(guestLangOf({ country: "IT" }), "it");
  assert.equal(guestLangOf({ country: "de" }), "de");
  assert.equal(guestLangOf({ country: "AT" }), "de");
  assert.equal(guestLangOf({ country: "FR" }), "fr");
  assert.equal(guestLangOf({ country: "ES" }), "es");
  assert.equal(guestLangOf({ country: "MX" }), "es");
});

test("Paese straniero non in elenco → inglese (GB, NL, US, JP…)", () => {
  for (const c of ["GB", "NL", "US", "JP", "SE", "PL", "BE"]) assert.equal(guestLangOf({ country: c }), "en", c);
});

test("senza Paese: dal prefisso del telefono; numero italiano senza prefisso → italiano", () => {
  assert.equal(guestLangOf({ phone: "+49 170 1234567" }), "de");
  assert.equal(guestLangOf({ phone: "0033 6 12 34 56 78" }), "fr");
  assert.equal(guestLangOf({ phone: "+34 600 000 000" }), "es");
  assert.equal(guestLangOf({ phone: "+44 7700 900000" }), "en");
  assert.equal(guestLangOf({ phone: "+31 6 12345678" }), "en");
  assert.equal(guestLangOf({ phone: "+39 333 7675693" }), "it");
  assert.equal(guestLangOf({ phone: "333 7675693" }), "it");
});

test("nessun dato → italiano come prima; il Paese vince sul telefono", () => {
  assert.equal(guestLangOf({}), "it");
  assert.equal(guestLangOf(undefined), "it");
  assert.equal(guestLangOf({ country: "GB", phone: "+39 333 0000000" }), "en");
});
