import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { countryFromPhone, langFromPhone, langFromCountry, normalizePhone } = await import("../src/lib/phone-country.ts");

test("normalizzazione: spazi, trattini, punti, 00, '+ 39', (0) di trunk, prefissi di testo", () => {
  assert.deepEqual(normalizePhone("+39 333-767.5693"), { digits: "393337675693", international: true });
  assert.deepEqual(normalizePhone("0039 333 7675693"), { digits: "393337675693", international: true });
  assert.deepEqual(normalizePhone("00 39 333 7675693"), { digits: "393337675693", international: true });
  assert.deepEqual(normalizePhone("+ 39 (333) 767 5693"), { digits: "393337675693", international: true });
  assert.deepEqual(normalizePhone("whatsapp:+44 (0) 7700 900000"), { digits: "447700900000", international: true });
  assert.deepEqual(normalizePhone("333 7675693"), { digits: "3337675693", international: false });
  assert.deepEqual(normalizePhone(""), { digits: "", international: false });
  assert.deepEqual(normalizePhone(null), { digits: "", international: false });
  assert.deepEqual(normalizePhone("n/d"), { digits: "", international: false });
});

test("paese dai prefissi principali", () => {
  const cases: [string, string][] = [
    ["+39 333 1234567", "IT"], ["+44 7700 900000", "GB"], ["+33 6 12 34 56 78", "FR"], ["+49 170 1234567", "DE"],
    ["+34 600 000 000", "ES"], ["+31 6 12345678", "NL"], ["+32 470 12 34 56", "BE"], ["+41 79 123 45 67", "CH"], ["+43 660 1234567", "AT"],
    ["+48 512 345 678", "PL"], ["+46 70 123 45 67", "SE"], ["+81 90 1234 5678", "JP"], ["+61 412 345 678", "AU"], ["+90 532 123 45 67", "TR"],
  ];
  for (const [n, c] of cases) assert.equal(countryFromPhone(n), c, n);
});

test("prefissi a lunghezza variabile: vince il più lungo che combacia", () => {
  assert.equal(countryFromPhone("+1 202 555 0100"), "US");
  assert.equal(countryFromPhone("+1 416 555 0100"), "CA");
  assert.equal(countryFromPhone("+1 809 555 0100"), "DO");
  assert.equal(countryFromPhone("+1 787 555 0100"), "PR");
  assert.equal(countryFromPhone("+7 912 345 67 89"), "RU");
  assert.equal(countryFromPhone("+7 701 345 67 89"), "KZ");
  assert.equal(countryFromPhone("+351 912 345 678"), "PT"); // non +35 / +3
  assert.equal(countryFromPhone("+352 621 123 456"), "LU");
  assert.equal(countryFromPhone("+420 601 123 456"), "CZ");
  assert.equal(countryFromPhone("+421 912 123 456"), "SK");
  assert.equal(countryFromPhone("+353 85 123 4567"), "IE");
  assert.equal(countryFromPhone("+378 0549 123456"), "SM"); // non +37
  assert.equal(countryFromPhone("+971 50 123 4567"), "AE");
  assert.equal(countryFromPhone("+212 612 345 678"), "MA");
  assert.equal(countryFromPhone("+55 11 91234 5678"), "BR");
  assert.equal(countryFromPhone("+1 999 555 0100"), "US"); // area code non speciale: NANP generico
});

test("scritture diverse dello stesso numero danno lo stesso paese", () => {
  for (const n of ["+39 333 7675693", "0039 333 7675693", "+39-333-7675693", "+393337675693", "39 333 7675693 "]) assert.equal(countryFromPhone(n), "IT", n);
  for (const n of ["+44 7700 900000", "0044 7700 900000", "+44 (0) 7700 900000", "447700900000"]) assert.equal(countryFromPhone(n), "GB", n);
  assert.equal(countryFromPhone("4917012345678"), "DE"); // senza "+": 13 cifre, non può essere un numero italiano
});

test("numeri italiani senza prefisso → IT; vuoto/non numero → null", () => {
  assert.equal(countryFromPhone("333 7675693"), "IT");
  assert.equal(countryFromPhone("3337675693"), "IT");
  assert.equal(countryFromPhone("0931 123456"), "IT");
  assert.equal(countryFromPhone("06 1234 5678"), "IT");
  assert.equal(countryFromPhone(""), null);
  assert.equal(countryFromPhone(undefined), null);
  assert.equal(countryFromPhone("---"), null);
});

test("prefisso internazionale sconosciuto → null per il paese, inglese per la lingua", () => {
  assert.equal(countryFromPhone("+999 123456"), null);
  assert.equal(langFromPhone("+999 123456"), "en");
});

test("lingua dal telefono: it · en · fr · de · es + mappa sensata", () => {
  const cases: [string, string][] = [
    ["+39 333 1234567", "it"], ["0039 333 1234567", "it"], ["333 1234567", "it"], ["+378 0549 123456", "it"],
    ["+44 7700 900000", "en"], ["+1 202 555 0100", "en"], ["+353 85 123 4567", "en"], ["+61 412 345 678", "en"], ["+31 6 12345678", "en"], ["+46 70 123 45 67", "en"],
    ["+81 90 1234 5678", "en"], ["+55 11 91234 5678", "en"],
    ["+33 6 12 34 56 78", "fr"], ["+352 621 123 456", "fr"], ["+377 6 12 34 56 78", "fr"], ["+212 612 345 678", "fr"], ["+221 77 123 45 67", "fr"],
    ["+49 170 1234567", "de"], ["+43 660 1234567", "de"], ["+41 79 123 45 67", "de"], ["+423 660 1234", "de"],
    ["+34 600 000 000", "es"], ["+52 55 1234 5678", "es"], ["+54 11 1234 5678", "es"], ["+57 300 123 4567", "es"], ["+1 809 555 0100", "es"], ["+1 787 555 0100", "es"],
  ];
  for (const [n, l] of cases) assert.equal(langFromPhone(n), l, n);
  assert.equal(langFromPhone(""), null);
  assert.equal(langFromPhone(null), null);
});

test("lingua dal paese: sconosciuto → inglese, maiuscole indifferenti", () => {
  assert.equal(langFromCountry("it"), "it");
  assert.equal(langFromCountry("De"), "de");
  assert.equal(langFromCountry("ZZ"), "en");
  assert.equal(langFromCountry(""), "en");
  assert.equal(langFromCountry(undefined), "en");
});
