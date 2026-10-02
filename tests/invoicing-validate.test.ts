import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidPartitaIvaIT, checkCodiceFiscale, isValidSdiCode, isValidPec, validateDocument, validateIssuerSettings, hasErrors, type DocCheckInput } from "../src/lib/invoicing/validate.ts";
import { computeResidui, agingBucket, daysOverdue } from "../src/lib/invoicing/receivables.ts";
import { bolloQuarters } from "../src/lib/invoicing/bollo.ts";
import { reminderText, waDigits, waReminderLink } from "../src/lib/invoicing/reminders.ts";
import { buildCsv, centsToCsv } from "../src/lib/invoicing/csv.ts";

test("P.IVA italiana: checksum", () => {
  assert.equal(isValidPartitaIvaIT("12345678903"), true);
  assert.equal(isValidPartitaIvaIT("IT12345678903"), true);
  assert.equal(isValidPartitaIvaIT("12345678901"), false);
  assert.equal(isValidPartitaIvaIT("1234567890"), false);
});

test("Codice fiscale: formato e controllo", () => {
  assert.deepEqual(checkCodiceFiscale("RSSMRA85T10A562S"), { format: true, checksum: true });
  assert.deepEqual(checkCodiceFiscale("rssmra85t10a562s"), { format: true, checksum: true });
  assert.equal(checkCodiceFiscale("RSSMRA85T10A562X").checksum, false);
  assert.equal(checkCodiceFiscale("RSSMRA85T10A562").format, false);
  assert.equal(checkCodiceFiscale("12345678903").format, true);
});

test("Codice destinatario e PEC", () => {
  assert.equal(isValidSdiCode("0000000"), true);
  assert.equal(isValidSdiCode("XXXXXXX"), true);
  assert.equal(isValidSdiCode("ABC12"), false);
  assert.equal(isValidPec("a@pec.it"), true);
  assert.equal(isValidPec("a@pec"), false);
});

const base = (): DocCheckInput => ({
  docKind: "fattura", regime: "imprenditoriale_ordinario", issueDate: "2026-10-01", dueDate: "2026-10-31", sendSdi: true,
  counterpart: { kind: "privato", name: "Mario", lastName: "Rossi", vat: "", tax_code: "RSSMRA85T10A562S", country: "IT", address: "Via Roma 1", city: "Siracusa", cap: "96100", province: "SR" },
  sdiCode: "0000000", pec: "", lines: [{ description: "Soggiorno", qty: 1, unitEur: 100, vat: "10" }],
  bollo: false, preBolloCents: 11000, totalCents: 11000, bolloThresholdCents: 7747,
  issuer: { denominazione: "Acme", vat: "12345678903", tax_code: null, address: "Via X", city: "Siracusa", cap: "96100", province: "SR" },
});

test("documento valido: nessun errore", () => {
  assert.equal(hasErrors(validateDocument(base())), false);
});
test("documento: errori bloccanti", () => {
  const d = base();
  d.counterpart.tax_code = ""; d.lines = []; d.dueDate = "2026-09-01"; d.issuer = null;
  const f = validateDocument(d).filter((i) => i.level === "error").map((i) => i.field);
  assert.ok(f.includes("counterpart.taxCode") && f.includes("lines") && f.includes("dueDate") && f.includes("issuer"));
});
test("forfettario: IVA in riga e bollo", () => {
  const d = base(); d.regime = "forfettario"; d.preBolloCents = 20000; d.bollo = false;
  const iss = validateDocument(d);
  assert.ok(iss.some((i) => i.field === "lines.0.vat" && i.level === "error"));
  assert.ok(iss.some((i) => i.field === "bollo" && i.level === "warn"));
  d.lines[0].vat = "N2.2"; d.bollo = true; d.preBolloCents = 5000;
  const iss2 = validateDocument(d);
  assert.ok(!iss2.some((i) => i.level === "error"));
  assert.ok(iss2.some((i) => i.field === "bollo"));
});
test("impostazioni emittente", () => {
  const s = { denominazione: "A", vat: "12345678901", tax_code: "", address: "x", city: "y", cap: "123", province: "Siracusa", country: "IT", pec: "no", sdi: "12", regime: "forfettario" };
  const f = validateIssuerSettings(s).filter((i) => i.level === "error").map((i) => i.field).sort();
  assert.deepEqual(f, ["cap", "pec", "province", "sdi", "vat"]);
});

test("scadenzario: la NC riduce il residuo e non è un credito", () => {
  const docs = [
    { id: "f1", doc_kind: "fattura", stato: "emessa", total_cents: 10000, due_date: "2026-09-01", related_document_id: null },
    { id: "n1", doc_kind: "nota_di_credito", stato: "emessa", total_cents: 4000, due_date: null, related_document_id: "f1" },
    { id: "n2", doc_kind: "nota_di_credito", stato: "bozza", total_cents: 9999, due_date: null, related_document_id: "f1" },
  ];
  const r = computeResidui(docs, { f1: 1000 });
  assert.equal(r.f1.residuo, 5000);
  assert.equal(r.f1.credited, 4000);
});
test("aging", () => {
  assert.equal(daysOverdue("2026-09-01", "2026-10-02"), 31);
  assert.equal(agingBucket("2026-09-01", "2026-10-02"), "d60");
  assert.equal(agingBucket("2026-10-05", "2026-10-02"), "future");
  assert.equal(agingBucket(null, "2026-10-02"), "nodue");
  assert.equal(agingBucket("2026-06-01", "2026-10-02"), "over90");
});

test("bollo per trimestre", () => {
  const q = bolloQuarters([{ issue_date: "2026-02-10", bollo_cents: 200 }, { issue_date: "2026-05-01", bollo_cents: 400 }, { issue_date: "2025-12-31", bollo_cents: 200 }], 2026);
  assert.equal(q[0].cents, 200); assert.equal(q[1].cents, 400); assert.equal(q[0].count, 1);
  assert.equal(q[0].postponable, true); assert.equal(q[3].dueDate, "2027-02-28");
});

test("solleciti e link", () => {
  const t = reminderText({ customerName: "Mario Rossi", docLabel: "fattura 12/2026", issueDate: "2026-08-01", dueDate: "2026-09-01", residuoCents: 123456, daysLate: 31, senderName: "Spigole House" });
  assert.match(t, /€ 1\.234,56/); assert.match(t, /01\/09\/2026/); assert.match(t, /Spigole House/);
  assert.equal(waDigits("333 123 4567"), "393331234567");
  assert.equal(waDigits("+39 333 1234567"), "393331234567");
  assert.equal(waDigits("0049 170 123"), "49170123");
  assert.equal(waReminderLink("", "x"), "");
});

test("csv italiano", () => {
  assert.equal(centsToCsv(123450), "1234,50");
  assert.equal(buildCsv(["a"], [['x"y']]), "﻿\"a\"\r\n\"x\"\"y\"");
});
