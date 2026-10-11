import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// booking.ts importa "./channelOverrides" che legge localStorage: qui si simula e si risolvono gli import con l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
} as Storage;
const { cityTaxOf, cityTaxOfBooking } = await import("../src/lib/booking.ts");

// Siracusa: (costo alloggio / numero ospiti) × 4%, tetto 5 € a persona per notte, massimo 7 notti, esenti i minori di 14 anni.
const siracusa = { cityTax: true, cityTaxMode: "percent", cityTaxPercent: 4, cityTaxCap: 5, cityTaxMaxNights: 7, cityTaxChildFreeUnder: 14 } as never;
const bk = (extra: Record<string, unknown> = {}) => ({ checkIn: "2026-10-10", checkOut: "2026-10-13", adults: 2, children: 0, total: 300, ...extra });

test("Siracusa: si divide per TUTTI gli ospiti, anche l'esente (2 adulti + bambino di 10 anni, 3 notti, 300 €)", () => {
  assert.equal(cityTaxOfBooking(siracusa, bk({ children: 1, childAges: [10] })), 8);
  // il vecchio calcolo (divisore = soli paganti) dava 12: resta solo se non si indica il numero di ospiti
  assert.equal(cityTaxOf(siracusa, 2, 3, 300), 12);
});

test("senza bambini il risultato non cambia", () => {
  assert.equal(cityTaxOfBooking(siracusa, bk({ total: 250 })), 10);
});

test("un ragazzo di 15 anni paga: paganti 3, ospiti 3", () => {
  assert.equal(cityTaxOfBooking(siracusa, bk({ children: 1, childAges: [15] })), 12);
});

test("tetto di 5 € a persona per notte e massimo 7 notti", () => {
  assert.equal(cityTaxOfBooking(siracusa, bk({ checkOut: "2026-10-11", total: 400 })), 10);         // 200 € a testa × 4% = 8, tetto 5 → 2 × 5
  assert.equal(cityTaxOfBooking(siracusa, bk({ checkOut: "2026-10-20", total: 1000 })), 28);        // 10 notti, tassate 7: 2 € a testa × 2 × 7
});

test("importi ai centesimi, esenti e modalità fissa", () => {
  assert.equal(cityTaxOf(siracusa, 1, 2, 100), 4);                                                    // 50 €/notte × 4% × 2 notti = 4,00
  assert.equal(cityTaxOf(siracusa, 3, 3, 333.33), 13.33);                                              // arrotondato ai centesimi, non all'euro
  assert.equal(cityTaxOfBooking(siracusa, bk({ cityTaxExempt: true })), 0);
  const fisso = { cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 1.5, cityTaxMaxNights: 3 } as never;
  assert.equal(cityTaxOf(fisso, 3, 3, 0), 13.5);
  assert.equal(cityTaxOf(undefined, 2, 3, 300), 0);
});
