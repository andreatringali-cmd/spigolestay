import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePhone, combinePhone } from "../src/app/(app)/ospiti/_phone.ts";

test("prefisso in elenco: scomposto e ricomposto senza perdite", () => {
  assert.deepEqual(parsePhone("+39 333 1234567"), { dial: "+39", local: "333 1234567" });
  assert.deepEqual(parsePhone("0044 7700 900000"), { dial: "+44", local: "7700 900000" });
  assert.equal(combinePhone("+351", " 912 345 678 "), "+351 912 345 678");
});

test("prefisso NON in elenco: mai riscritto come +39, il numero resta intero", () => {
  for (const raw of ["+212 612345678", "+971 50 123 4567", "+91 98765 43210", "+972 52 123 4567", "+385 91 123 4567", "+82 10 1234 5678"]) {
    const p = parsePhone(raw);
    assert.equal(p.dial, "", raw);
    assert.equal(combinePhone(p.dial, p.local), raw, raw);
  }
});

test("numero senza prefisso: +39 solo se il Paese è l'Italia o sconosciuto", () => {
  assert.equal(parsePhone("333 1234567").dial, "+39");
  assert.equal(parsePhone("333 1234567", "IT").dial, "+39");
  assert.deepEqual(parsePhone("0651964616", "NL"), { dial: "", local: "0651964616" });
});

test("vuoto: nessun numero salvato", () => {
  assert.equal(combinePhone("+39", ""), "");
  assert.equal(combinePhone("", "  "), "");
});

test("formato OTA prefisso-zona-numero-: non viene riscritto come +39", () => {
  for (const raw of ["39--3934335777-", "44-3-308225121-", "0-0-18574458226-"]) {
    for (const country of [undefined, "", "IT"]) {
      const p = parsePhone(raw, country);
      assert.deepEqual(p, { dial: "", local: raw }, `${raw} ${country}`);
      assert.equal(combinePhone(p.dial, p.local), raw, raw);
    }
  }
});
