import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { guestLangOf, guestCountryOf, countryCodeOf, guestLangHint, guestLangOrNull } = await import("../src/lib/guest-lang.ts");

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

test("Paese scritto per esteso: Italia → it, sconosciuto → si passa al telefono", () => {
  assert.equal(countryCodeOf("Italia"), "IT");
  assert.equal(countryCodeOf("Germany"), "DE");
  assert.equal(countryCodeOf("Atlantide"), "");
  assert.equal(guestLangOf({ country: "Italia" }), "it");
  assert.equal(guestLangOf({ country: "Atlantide", phone: "+33 6 12 34 56 78" }), "fr");
});

test("Paese dell'ospite: dalla scheda, altrimenti dal prefisso del telefono", () => {
  assert.equal(guestCountryOf({ country: "nl", phone: "+39 333 1234567" }), "NL");
  assert.equal(guestCountryOf({ phone: "+49 170 1234567" }), "DE");
  assert.equal(guestCountryOf({}), null);
});

test("suggerimento per il concierge: lingua della scheda, altrimenti Paese/prefisso ma solo se non italiano", () => {
  assert.equal(guestLangHint({ language: "fr" }), "fr");
  assert.equal(guestLangHint({ phone: "+49 170 1234567" }), "de");
  assert.equal(guestLangHint({ phone: "+39 333 1234567" }), undefined);
  assert.equal(guestLangHint({}), undefined);
});

test("lingua della pagina ospite: null se non c'è nessun dato (decide il browser), altrimenti come guestLangOf", () => {
  assert.equal(guestLangOrNull({}), null);
  assert.equal(guestLangOrNull(undefined), null);
  assert.equal(guestLangOrNull({ phone: "  " }), null);
  assert.equal(guestLangOrNull({ phone: "+39 333 1234567" }), "it");
  assert.equal(guestLangOrNull({ phone: "0044 7700 900000" }), "en");
  assert.equal(guestLangOrNull({ language: "de" }), "de");
  assert.equal(guestLangOrNull({ country: "FR" }), "fr");
});
