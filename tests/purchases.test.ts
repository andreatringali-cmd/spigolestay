import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTotals, dueSummary, matchesDue, toCashRow, findDuplicate, cashCategoryOf, cashContoOf, type PDoc } from "../src/lib/purchases.ts";

const doc = (o: Partial<PDoc>): PDoc => ({ id: "x", structure_id: "s1", supplier_name: "Enel", doc_number: "1", doc_date: "2026-03-10", doc_type: "fattura", category: "Utenze", taxable_cents: 10000, vat_cents: 2200, total_cents: 12200, due_date: null, paid: false, paid_at: null, payment_method: "Bonifico bancario", ...o });

test("nota di credito sottrae dai totali, qualunque segno sia stato digitato", () => {
  const rows = groupTotals([doc({}), doc({ id: "n", doc_type: "nota_credito", total_cents: 2000 }), doc({ id: "m", doc_type: "nota_credito", total_cents: -1000 })], "supplier");
  assert.equal(rows[0].total, 12200 - 2000 - 1000);
  assert.equal(rows[0].count, 3);
});

test("raggruppamento per mese ordinato e per categoria", () => {
  const rows = groupTotals([doc({ id: "a", doc_date: "2026-05-01" }), doc({ id: "b", doc_date: "2026-03-01", category: null })], "month");
  assert.deepEqual(rows.map((r) => r.key), ["2026-03", "2026-05"]);
  assert.equal(groupTotals([doc({ category: null })], "category")[0].key, "Senza categoria");
});

test("scadenzario: scadute, entro 7 giorni, oltre; pagate e note escluse", () => {
  const today = "2026-10-10";
  const s = dueSummary([
    doc({ id: "1", due_date: "2026-10-09" }), doc({ id: "2", due_date: "2026-10-10" }), doc({ id: "3", due_date: "2026-10-17" }),
    doc({ id: "4", due_date: "2026-10-18" }), doc({ id: "5" }), doc({ id: "6", due_date: "2026-01-01", paid: true }), doc({ id: "7", due_date: "2026-01-01", doc_type: "nota_credito" }),
  ], today);
  assert.equal(s.overdue.count, 1); assert.equal(s.week.count, 2); assert.equal(s.later.count, 1); assert.equal(s.noDate.count, 1);
  assert.equal(matchesDue(doc({ due_date: "2026-10-09" }), "overdue", today), true);
  assert.equal(matchesDue(doc({ due_date: "2026-10-09" }), "week", today), false);
  assert.equal(matchesDue(doc({ due_date: "2026-10-12", paid: true }), "week", today), false);
});

test("riga di Cassa: id = id documento, solo se pagata, mappature", () => {
  assert.equal(toCashRow(doc({}), "t", "2026-10-10"), null);
  const r = toCashRow(doc({ id: "abc", paid: true, paid_at: "2026-04-02", payment_method: "Contanti", category: "Pulizie" }), "t", "2026-10-10")!;
  assert.equal(r.id, "abc"); assert.equal(r.kind, "out"); assert.equal(r.conto, "contanti"); assert.equal(r.cat, "pulizie"); assert.equal(r.date, "2026-04-02"); assert.equal(r.amount_cents, 12200);
  assert.equal(toCashRow(doc({ paid: true, doc_type: "nota_credito" }), "t", "2026-10-10")!.kind, "in");
  assert.equal(cashCategoryOf("OTA / commissioni"), "altro_out"); assert.equal(cashContoOf("RID/SDD"), "banca"); assert.equal(cashContoOf("PayPal"), "paypal");
});

test("duplicati: stesso fornitore, numero, anno", () => {
  const list = [doc({ id: "1", supplier_name: "Enel ", doc_number: "A/1" })];
  assert.ok(findDuplicate(list, { supplier_name: "enel", doc_number: "a/1", doc_date: "2026-12-01" }));
  assert.equal(findDuplicate(list, { id: "1", supplier_name: "enel", doc_number: "a/1", doc_date: "2026-12-01" }), undefined);
  assert.equal(findDuplicate(list, { supplier_name: "enel", doc_number: "a/1", doc_date: "2025-12-01" }), undefined);
  assert.equal(findDuplicate(list, { supplier_name: "enel", doc_number: "", doc_date: "2026-12-01" }), undefined);
});
