import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
} as Storage;
const booking = await import("../src/lib/booking.ts");
const tax = await import("../src/lib/citytax.ts");

const siracusa = { id: "s1", cityTax: true, cityTaxMode: "percent", cityTaxPercent: 4, cityTaxCap: 5, cityTaxMaxNights: 7, cityTaxChildFreeUnder: 14 } as never;
const bk = (o: Record<string, unknown> = {}) => ({ id: "b1", structureId: "s1", status: "confirmed", channel: "direct", checkIn: "2026-10-10", checkOut: "2026-10-13", adults: 2, children: 0, total: 300, ...o }) as never;

test("la pagina Tassa di soggiorno dà lo stesso importo di check-in/fatture (cityTaxOfBooking)", () => {
  const rules = tax.cityTaxRulesOf(siracusa)!;
  for (const b of [bk(), bk({ children: 1, childAges: [10] }), bk({ children: 1, childAges: [15] }), bk({ total: 1000, checkOut: "2026-10-20" }), bk({ cityTaxExempt: true })]) {
    assert.equal(tax.cityTaxForBooking(b, rules, siracusa).tax, booking.cityTaxOfBooking(siracusa, b));
  }
  // bambino di 10 anni: divisore = 3 ospiti, paganti = 2 → 8 €
  assert.equal(tax.cityTaxForBooking(bk({ children: 1, childAges: [10] }), rules, siracusa).tax, 8);
  assert.equal(tax.cityTaxForBooking(bk({ children: 1, childAges: [10] }), rules, siracusa).persons, 2);
});

test("gruppo di camere: la quota di gruppo entra anche nella pagina e nel totale", () => {
  const rooms = [bk({ id: "g1", groupId: "G", adults: 2, total: 300 }), bk({ id: "g2", groupId: "G", adults: 1, total: 120 })];
  booking.setGroupTaxContext(rooms as never, () => siracusa);
  const rules = tax.cityTaxRulesOf(siracusa)!;
  const sum = rooms.reduce((a, r) => a + tax.cityTaxForBooking(r, rules, siracusa).tax, 0);
  assert.equal(Math.round(sum * 100) / 100, booking.cityTaxOfGroup(siracusa, rooms as never));
  assert.equal(tax.cityTaxTotalByStructure(rooms, () => siracusa).total, booking.cityTaxOfGroup(siracusa, rooms as never));
  booking.setGroupTaxContext([], () => siracusa);
});

test("annullate, no-show e blocchi non entrano nel totale", () => {
  const list = [bk({ id: "a" }), bk({ id: "b", status: "no_show" }), bk({ id: "c", status: "cancelled" }), bk({ id: "d", channel: "blocked" })];
  const r = tax.cityTaxTotalByStructure(list, () => siracusa);
  assert.equal(r.count, 1);
  assert.equal(r.total, booking.cityTaxOfBooking(siracusa, list[0]));
  assert.equal(tax.cityTaxTotal(list, tax.cityTaxRulesOf(siracusa)!, siracusa).count, 1);
});

test("soglia d'età non impostata: vale DEFAULT_CITY_TAX_FREE_UNDER di booking.ts (18), la STESSA di totali e fatture", () => {
  const senza = { id: "s2", cityTax: true, cityTaxMode: "percent", cityTaxPercent: 4, cityTaxCap: 5, cityTaxMaxNights: 7 } as never;
  assert.equal(booking.DEFAULT_CITY_TAX_FREE_UNDER, 18);
  assert.equal(tax.cityTaxRulesOf(senza)!.exemptAge, booking.DEFAULT_CITY_TAX_FREE_UNDER);
  // ragazzo di 15 anni: con soglia 18 e' esente (2 paganti su 3 ospiti → 8 €) e la pagina dà lo stesso importo di cityTaxOfBooking
  const b = bk({ structureId: "s2", children: 1, childAges: [15] });
  const r = tax.cityTaxForBooking(b, tax.cityTaxRulesOf(senza)!, senza);
  assert.equal(r.tax, 8); assert.equal(r.persons, 2);
  assert.equal(r.tax, booking.cityTaxOfBooking(senza, b));
  // con la soglia impostata a 14 lo stesso ragazzo paga (12 €), sia nella pagina sia nei totali
  const con14 = { ...(senza as object), cityTaxChildFreeUnder: 14 } as never;
  assert.equal(tax.cityTaxForBooking(b, tax.cityTaxRulesOf(con14)!, con14).tax, 12);
  assert.equal(booking.cityTaxOfBooking(con14, b), 12);
});

test("simulazione con regole modificate: calcolo sulla singola prenotazione con le regole indicate", () => {
  const rules = { ...tax.cityTaxRulesOf(siracusa)!, pct: 2 };
  const r = tax.cityTaxForBooking(bk(), rules, siracusa);
  assert.equal(r.tax, 6); // 300/3 notti/2 ospiti × 2% × 2 persone × 3 notti = 6
  const fisso = { taxMode: "fisso" as const, amount: 1.5, pct: 0, cap: 0, maxNights: 2, childrenExempt: true, exemptAge: 14 };
  const f = tax.cityTaxForBooking(bk(), fisso);
  assert.equal(f.tax, 6); // 2 persone × 2 notti × 1,5
  assert.equal(f.taxable, 2);
});

test("toggle 'minori esenti (senza età)' spento: i bambini senza età pagano", () => {
  const rules = { ...tax.cityTaxRulesOf(siracusa)!, childrenExempt: false };
  const r = tax.cityTaxForBooking(bk({ children: 1 }), rules);
  assert.equal(r.persons, 3);
});
