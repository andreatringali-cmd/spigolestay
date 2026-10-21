import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Gli import senza estensione si risolvono con l'hook di tests/helpers; le funzioni leggono localStorage: qui si simula.
register("./helpers/alias-loader.mjs", import.meta.url);
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0,
} as Storage;
const { bookingTotals, totalsFromAmounts, totalsBreakdown } = await import("../src/lib/booking-totals.ts");
const { nextQuoteNumber } = await import("../src/lib/quote-number.ts");
const { eur } = await import("../src/lib/format.ts");

// 187 € nel soggiorno + 8 € di tassa = 195 €: due totali diversi, ognuno col suo nome, calcolati in un solo posto.
const structure = { id: "s1", name: "Casa", cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2, cityTaxChildFreeUnder: 18 } as never;
const b = { id: "b1", structureId: "s1", total: 187, adults: 2, children: 0, checkIn: "2026-11-01", checkOut: "2026-11-03" } as never; // 2 adulti × 2 notti × 2 € = 8 €

test("totale soggiorno, tassa e totale con tassa: 187 + 8 = 195", () => {
  const t = bookingTotals(b, structure);
  assert.deepEqual(t, { stay: 187, tax: 8, withTax: 195 });
  assert.equal(t.stay + t.tax, t.withTax);
});

test("pulizia ed extra stanno nel totale soggiorno, la tassa no", () => {
  const withExtras = { ...(b as object), cleaningFee: 20, extras: [{ price: 15 }] } as never;
  const t = bookingTotals(withExtras, structure);
  assert.equal(t.stay, 222);
  assert.equal(t.withTax, 230);
});

test("tassa esente o struttura senza tassa: totale con tassa = totale soggiorno", () => {
  assert.deepEqual(bookingTotals({ ...(b as object), cityTaxExempt: true } as never, structure), { stay: 187, tax: 0, withTax: 187 });
  assert.deepEqual(bookingTotals(b, { ...(structure as object), cityTax: false } as never), { stay: 187, tax: 0, withTax: 187 });
});

test("senza prezzo del soggiorno è tutto 0", () => {
  assert.deepEqual(bookingTotals({ ...(b as object), total: 0 } as never, structure), { stay: 0, tax: 0, withTax: 0 });
});

test("riga di scomposizione leggibile", () => {
  assert.equal(totalsBreakdown(totalsFromAmounts(187, 8), (n) => eur(n)).replace(/ /g, " "), "Soggiorno € 187,00 · Tassa € 8,00 · Totale € 195,00");
  assert.equal(totalsBreakdown(totalsFromAmounts(187, 0), (n) => eur(n)).replace(/ /g, " "), "Soggiorno € 187,00");
  assert.deepEqual(totalsFromAmounts(187.1, 8.2), { stay: 187.1, tax: 8.2, withTax: 195.3 }); // niente errori di virgola mobile
});

test("preventivi: il primo di una struttura nuova è il n. 1, anche se un'altra struttura ne ha già emessi", () => {
  const saved = [
    { number: 1, createdAt: "2026-03-01", structureId: "s1" },
    { number: 2, createdAt: "2026-04-01", structureId: "s1" },
  ];
  assert.equal(nextQuoteNumber(saved, "s2", 2026), 1);
  assert.equal(nextQuoteNumber(saved, "s1", 2026), 3);
  assert.equal(nextQuoteNumber(saved, "s1", 2027), 1); // riparte ogni anno
  assert.equal(nextQuoteNumber([], "s1", 2026), 1);
});

test("preventivi vecchi senza struttura contano per tutte (nessun numero ripetuto)", () => {
  assert.equal(nextQuoteNumber([{ number: 4, createdAt: "2026-02-01" }], "s9", 2026), 5);
});
