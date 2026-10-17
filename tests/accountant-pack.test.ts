import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// accountant-pack.ts importa i moduli "puri" con import senza estensione: si risolvono con l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const P = await import("../src/lib/accountant-pack.ts");

const doc = (o: Record<string, unknown> = {}) => ({
  id: String(Math.random()), structure_id: "s1", doc_kind: "fattura", stato: "consegnata", issue_date: "2026-10-05", created_at: "2026-10-05T10:00:00Z",
  number_label: "1/2026", counterpart: { name: "Mario", lastName: "Rossi", vat: null, tax_code: "RSSMRA80A01H501U", country: "IT" },
  taxable_cents: 10000, vat_cents: 0, out_of_scope_cents: 0, bollo_cents: 0, total_cents: 10000, regime: "forfettario", send_sdi: true, ...o,
}) as never;

test("periodo: trimestri e anno, intervallo semiaperto e ultimo giorno", () => {
  const q4 = P.periodRange({ year: 2026, q: 4 });
  assert.deepEqual([q4.from, q4.to, q4.lastDay, q4.label], ["2026-10-01", "2027-01-01", "2026-12-31", "4º trimestre 2026"]);
  const q1 = P.periodRange({ year: 2026, q: 1 });
  assert.deepEqual([q1.from, q1.to, q1.lastDay], ["2026-01-01", "2026-04-01", "2026-03-31"]);
  const y = P.periodRange({ year: 2026, q: 0 });
  assert.deepEqual([y.from, y.to, y.lastDay, y.label], ["2026-01-01", "2027-01-01", "2026-12-31", "Anno 2026"]);
  assert.equal(P.inRange("2026-12-31", q4), true);
  assert.equal(P.inRange("2027-01-01", q4), false);
  assert.equal(P.inRange("2026-09-30", q4), false);
  assert.equal(P.inRange(null, q4), false);
});

test("periodo: chiave, parsing e trimestre corrente", () => {
  assert.equal(P.periodKey({ year: 2026, q: 3 }), "2026-Q3");
  assert.equal(P.periodKey({ year: 2026, q: 0 }), "2026-Y");
  assert.deepEqual(P.parsePeriodKey("2026-Q2"), { year: 2026, q: 2 });
  assert.deepEqual(P.parsePeriodKey("2025-Y"), { year: 2025, q: 0 });
  assert.equal(P.parsePeriodKey("2026-Q5"), null);
  assert.deepEqual(P.currentPeriod(new Date(2026, 9, 13)), { year: 2026, q: 4 }); // 13 ottobre
  assert.deepEqual(P.currentPeriod(new Date(2026, 0, 1)), { year: 2026, q: 1 });
});

test("fatture emesse: note di credito con segno negativo e totali", () => {
  const r = P.periodRange({ year: 2026, q: 4 });
  const inv = P.packInvoices([
    doc({ id: "a", number_label: "1/2026", taxable_cents: 10000, total_cents: 10000 }),
    doc({ id: "b", number_label: "2/2026", issue_date: "2026-11-02", taxable_cents: 20000, out_of_scope_cents: 500, bollo_cents: 200, total_cents: 20700 }),
    doc({ id: "c", doc_kind: "nota_di_credito", number_label: "NC1/2026", issue_date: "2026-11-10", taxable_cents: 5000, total_cents: 5000 }),
  ], r, "all");
  assert.equal(inv.nFatture, 2);
  assert.equal(inv.nNoteCredito, 1);
  assert.equal(inv.rows.find((x: { id: string }) => x.id === "c")!.total, -5000);
  assert.deepEqual(inv.totals, { taxable: 25000, vat: 0, outOfScope: 500, bollo: 200, total: 25700 });
  assert.deepEqual(inv.rows.map((x: { id: string }) => x.id), ["a", "b", "c"]); // ordinate per data
});

test("fatture emesse: bozze, scartate, stornate, ricevute, fuori periodo e altre strutture sono escluse", () => {
  const r = P.periodRange({ year: 2026, q: 4 });
  const inv = P.packInvoices([
    doc({ id: "ok" }),
    doc({ id: "bz", stato: "bozza" }),
    doc({ id: "sc", stato: "scartata" }),
    doc({ id: "st", stato: "stornata" }),
    doc({ id: "rc", doc_kind: "ricevuta_non_fiscale", stato: "emessa" }),
    doc({ id: "old", issue_date: "2026-09-30" }),
    doc({ id: "alt", structure_id: "s2" }),
  ], r, "s1");
  assert.deepEqual(inv.rows.map((x: { id: string }) => x.id), ["ok"]);
  assert.equal(inv.drafts, 1);
  assert.equal(inv.rejected, 1);
  assert.equal(inv.annulled, 1);
  assert.equal(inv.totals.total, 10000);
  // "Tutte le strutture" include anche s2
  assert.equal(P.packInvoices([doc({ id: "ok" }), doc({ id: "alt", structure_id: "s2" })], r, "all").rows.length, 2);
});

test("fatture emesse: senza issue_date vale la data di creazione; stato 'in prova' e 'non inviata'", () => {
  const r = P.periodRange({ year: 2026, q: 4 });
  const inv = P.packInvoices([
    doc({ id: "nd", issue_date: null, created_at: "2026-10-20T08:00:00Z" }),
    doc({ id: "tr", stato: "inviata_intermediario" }),
    doc({ id: "em", stato: "emessa" }),
    doc({ id: "em2", stato: "emessa", send_sdi: false }),
  ], r, "all", new Set(["tr"]));
  const by = (id: string) => inv.rows.find((x: { id: string }) => x.id === id)!;
  assert.equal(by("nd").date, "2026-10-20");
  assert.equal(by("nd").hasIssueDate, false);
  assert.equal(by("tr").trial, true);
  assert.match(by("tr").statoLabel, /prova/i);
  assert.equal(by("em").notSent, true);
  assert.equal(by("em2").notSent, false);
  assert.equal(by("em2").statoLabel, "Emessa");
});

test("codice fiscale mancante: solo clienti italiani senza P.IVA né CF; esteri e NC esclusi", () => {
  const r = P.periodRange({ year: 2026, q: 4 });
  const cp = (o: Record<string, unknown>) => ({ name: "X", vat: null, tax_code: null, country: "IT", ...o });
  const inv = P.packInvoices([
    doc({ id: "m", counterpart: cp({}) }),
    doc({ id: "ok", counterpart: cp({ tax_code: "ABC" }) }),
    doc({ id: "az", counterpart: cp({ vat: "01234567890" }) }),
    doc({ id: "es", counterpart: cp({ country: "DE" }) }),
    doc({ id: "nc", doc_kind: "nota_di_credito", counterpart: cp({}) }),
  ], r, "all");
  assert.deepEqual(inv.rows.filter((x: { missingTaxCode: boolean }) => x.missingTaxCode).map((x: { id: string }) => x.id), ["m"]);
});

test("bollo: conteggio, importo e scadenza F24 dal trimestre (bollo.ts)", () => {
  const docs = [
    doc({ id: "a", issue_date: "2026-10-05", bollo_cents: 200 }),
    doc({ id: "b", issue_date: "2026-11-05", bollo_cents: 200 }),
    doc({ id: "c", issue_date: "2026-11-06", bollo_cents: 0 }),
    doc({ id: "d", issue_date: "2026-07-05", bollo_cents: 200 }),
    doc({ id: "e", issue_date: "2026-10-07", bollo_cents: 200, stato: "bozza" }),
    doc({ id: "f", issue_date: "2026-10-08", bollo_cents: 200, stato: "scartata" }),
  ];
  const q4 = P.packBollo(docs, { year: 2026, q: 4 }, "all");
  assert.equal(q4.count, 2);
  assert.equal(q4.cents, 400);
  assert.equal(q4.quarters.length, 1);
  assert.equal(q4.quarters[0].dueDate, "2027-02-28");
  assert.equal(q4.quarters[0].tributo, "2524");
  const y = P.packBollo(docs, { year: 2026, q: 0 }, "all");
  assert.equal(y.count, 3);
  assert.equal(y.cents, 600);
  assert.equal(y.quarters.length, 4);
  // una nota di credito con bollo lo riduce
  const withNc = P.packBollo([...docs, doc({ id: "n", doc_kind: "nota_di_credito", issue_date: "2026-10-09", bollo_cents: 200 })], { year: 2026, q: 4 }, "all");
  assert.equal(withNc.cents, 200);
});

test("imposta di soggiorno: arrivi nel periodo, incassata/da incassare, struttura senza tassa", () => {
  const r = P.periodRange({ year: 2026, q: 4 });
  const b = (o: Record<string, unknown>) => ({ checkIn: "2026-10-10", structureId: "s1", status: "confirmed", channel: "direct", cityTaxPaid: false, ...o }) as never;
  const taxOf = (x: { structureId: string }) => (x.structureId === "s1" ? 10.5 : null);
  const t = P.packCityTax([
    b({}), b({ cityTaxPaid: true }), b({ checkIn: "2026-09-30" }), b({ status: "cancelled" }), b({ channel: "blocked" }), b({ structureId: "s2" }),
  ], taxOf, r, "all");
  assert.deepEqual(t, { enabled: true, count: 2, dovuta: 21, incassata: 10.5, daIncassare: 10.5 });
  const none = P.packCityTax([b({ structureId: "s2" })], taxOf, r, "all");
  assert.equal(none.enabled, false);
});

test("incassi per metodo nel periodo e fatture non incassate (con NC collegata)", () => {
  const r = P.periodRange({ year: 2026, q: 4 });
  const docs = [
    doc({ id: "f1", total_cents: 10000 }),
    doc({ id: "f2", total_cents: 20000, issue_date: "2026-10-12", number_label: "2/2026" }),
    doc({ id: "f3", total_cents: 30000, issue_date: "2026-10-13", number_label: "3/2026" }),
    doc({ id: "nc", doc_kind: "nota_di_credito", related_document_id: "f3", total_cents: 30000, issue_date: "2026-10-14" }),
  ];
  const pays = [
    { document_id: "f1", amount_cents: 10000, method: "Bonifico bancario", paid_at: "2026-10-06T09:00:00Z" },
    { document_id: "f2", amount_cents: 5000, method: "carta", paid_at: "2026-10-15T09:00:00Z" },
    { document_id: "f2", amount_cents: 2000, method: "Carta", paid_at: "2026-10-16T09:00:00Z" },
    { document_id: "f2", amount_cents: 999, method: "Contanti", paid_at: "2026-09-01T09:00:00Z" }, // fuori periodo
    { document_id: "f2", amount_cents: 100, method: null, paid_at: "2026-10-17T09:00:00Z" },
  ];
  const inc = P.packIncassi(pays, docs, r, "all");
  assert.equal(inc.cents, 17100);
  assert.deepEqual(inc.rows.map((x: { method: string; cents: number }) => [x.method, x.cents]), [["Bonifico bancario", 10000], ["Carta", 7000], ["Non indicato", 100]]);
  const un = P.packUnpaid(docs, pays, r, "all");
  // f1 saldata; f2 pagata solo 7100 nel periodo + 999 prima = 8099 → residuo 11901; f3 stornata dalla NC
  assert.deepEqual(un.rows.map((x: { id: string; residuo: number }) => [x.id, x.residuo]), [["f2", 20000 - 5000 - 2000 - 999 - 100]]);
  assert.equal(un.cents, 11901);
  assert.equal(un.count, 1);
});

test("fatture passive: periodo, note di credito in negativo, non pagate", () => {
  const r = P.periodRange({ year: 2026, q: 4 });
  const pd = (o: Record<string, unknown>) => ({ id: "x", structure_id: "s1", supplier_name: "Forn", doc_number: "1", doc_date: "2026-10-03", doc_type: "fattura", category: null, taxable_cents: 10000, vat_cents: 2200, total_cents: 12200, due_date: null, paid: false, paid_at: null, payment_method: null, ...o }) as never;
  const p = P.packPurchases([
    pd({}), pd({ doc_date: "2026-11-03", paid: true }),
    pd({ doc_type: "nota_credito", taxable_cents: 1000, vat_cents: 220, total_cents: 1220 }),
    pd({ doc_date: "2026-08-03" }), pd({ structure_id: "s2" }),
  ], r, "s1");
  assert.equal(p.count, 3);
  assert.equal(p.taxable, 19000);
  assert.equal(p.vat, 4180);
  assert.equal(p.total, 23180);
  assert.equal(p.unpaidCount, 1);
  assert.equal(p.unpaidCents, 12200);
});

test("pacchetto completo: checklist oggettiva, CSV con separatore ; e decimali con virgola", () => {
  const docs = [
    doc({ id: "a", counterpart: { name: "Ospite", vat: null, tax_code: null, country: "IT" }, bollo_cents: 200, out_of_scope_cents: 300, total_cents: 10500, taxable_cents: 10000 }),
    doc({ id: "b", stato: "inviata_intermediario", number_label: "2/2026" }),
    doc({ id: "c", stato: "emessa", number_label: "3/2026" }),
    doc({ id: "d", stato: "bozza" }),
    doc({ id: "e", stato: "scartata" }),
  ];
  const pack = P.buildAccountantPack({
    period: { year: 2026, q: 4 }, structureId: "all", structureLabel: "Spigole House", docs, payments: [], trialIds: new Set(["b"]), purchases: [],
    bookings: [], cityTaxOf: () => null,
  });
  const text = pack.checklist.join(" | ");
  assert.match(text, /1 fattura a cliente italiano senza P\.IVA né codice fiscale/);
  assert.match(text, /1 documento in prova/);
  assert.match(text, /1 documento emesso non ancora inviato allo SdI/);
  assert.match(text, /1 documento scartato dallo SdI/);
  assert.match(text, /1 bozza nel periodo/);
  assert.match(text, /1 fattura con bollo calcolato, per € 2,00/);
  assert.match(text, /fuori campo IVA/);
  assert.match(text, /forfettario/);
  assert.doesNotMatch(text, /limite/i);

  const inv = P.invoicesCsv(pack);
  assert.equal(inv.filename, "commercialista-fatture-emesse-2026-T4-spigole-house");
  const lines = inv.csv.replace("﻿", "").split("\r\n");
  assert.equal(lines[0].split(";").length, 12);
  assert.match(lines[1], /^"05\.10\.2026";"1\/2026";"Fattura"/);
  assert.match(lines[1], /"105,00"/);
  assert.match(lines[lines.length - 1], /"TOTALE"/);

  const sum = P.summaryCsv(pack);
  assert.match(sum.filename, /^commercialista-riepilogo-2026-T4/);
  assert.match(sum.csv, /Domande aperte/);
  assert.match(sum.csv, /Rimborso imposta di bollo/);
  assert.match(sum.csv, /2027-?|28\/02\/2027/);
  assert.equal(P.purchasesCsv(pack).csv.split("\r\n").length, 2); // intestazione + totale
});

test("domande aperte e istruzione Fatture in Cloud: solo promemoria, nessun URL", () => {
  assert.equal(P.OPEN_QUESTIONS.length, 3);
  for (const g of P.OPEN_QUESTIONS) for (const q of g.items) assert.ok(q.trim().endsWith("?"));
  assert.match(P.FIC_SHARE_STEPS, /Commercialista/);
  assert.doesNotMatch(P.FIC_SHARE_STEPS, /https?:/);
});
