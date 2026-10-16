import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { closingBalance, computeBalances, nextRecurrenceStart, occurrences, OPENING_CAT } = await import("../src/lib/cassa.ts");
const { parseDecimalIT } = await import("../src/lib/num-it.ts");

const mv = (id: string, date: string, kind: "in" | "out", amount: number, conto = "contanti", cat = "altro") => ({ id, date, kind, cat, desc: id, amount, conto });

// --- Chiusura cassa: saldo teorico come la Cassa (segnalazione r4 #2) ---
test("saldo teorico di chiusura: incasso agosto 300, saldo di partenza 500 al 1/9, uscita 50 il 5/9 = 450 (non 750)", () => {
  const movs = [
    mv("agosto", "2026-08-20", "in", 300),
    mv("apertura", "2026-09-01", "in", 500, "contanti", OPENING_CAT),
    mv("uscita", "2026-09-05", "out", 50),
  ];
  assert.equal(closingBalance(movs, "2026-09-30", "contanti").saldo, 450);
  // identico alla Cassa
  assert.equal(computeBalances(movs, "2026-09-30", ["contanti"]).contanti.saldo, 450);
});

test("saldo teorico di chiusura: i movimenti dopo il giorno scelto non contano", () => {
  const movs = [mv("apertura", "2026-09-01", "in", 500, "contanti", OPENING_CAT), mv("a", "2026-09-05", "out", 50), mv("b", "2026-09-20", "in", 1000)];
  assert.equal(closingBalance(movs, "2026-09-10", "contanti").saldo, 450);
  assert.equal(closingBalance(movs, "2026-09-20", "contanti").saldo, 1450);
});

test("saldo teorico di chiusura: senza saldo di partenza è la somma fino al giorno, il futuro escluso", () => {
  const movs = [mv("a", "2026-09-01", "in", 100), mv("b", "2026-09-03", "out", 30), mv("futuro", "2026-12-01", "in", 999)];
  assert.equal(closingBalance(movs, "2026-09-10", "contanti").saldo, 70);
  assert.equal(closingBalance([], "2026-09-10", "contanti").saldo, 0);
});

// --- Pagamento ricorrente: la partenza non salta febbraio (segnalazione r4 #7) ---
test("nextRecurrenceStart mensile: dal 31/01 riparte a fine febbraio, non il 3 marzo", () => {
  assert.equal(nextRecurrenceStart("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(nextRecurrenceStart("2026-01-30", "monthly"), "2026-02-28");
  assert.equal(nextRecurrenceStart("2026-01-29", "monthly"), "2026-02-28");
  assert.equal(nextRecurrenceStart("2028-01-31", "monthly"), "2028-02-29"); // anno bisestile
  assert.equal(nextRecurrenceStart("2026-03-31", "monthly"), "2026-04-30");
  assert.equal(nextRecurrenceStart("2026-12-15", "monthly"), "2027-01-15");
  assert.equal(nextRecurrenceStart("2026-05-10", "monthly"), "2026-06-10");
});

test("nextRecurrenceStart: settimanale e annuale", () => {
  assert.equal(nextRecurrenceStart("2026-01-28", "weekly"), "2026-02-04");
  assert.equal(nextRecurrenceStart("2026-12-28", "weekly"), "2027-01-04");
  assert.equal(nextRecurrenceStart("2028-02-29", "yearly"), "2029-02-28");
  assert.equal(nextRecurrenceStart("2026-06-15", "yearly"), "2027-06-15");
});

test("una regola mensile del 31 creata il 31/01 ha la scadenza di febbraio", () => {
  const start = nextRecurrenceStart("2026-01-31", "monthly");
  const rule = { id: "r", kind: "out" as const, cat: "affitto", desc: "Affitto", amount: 800, conto: "banca", freq: "monthly" as const, day: 31, start, auto: true };
  const occ = occurrences(rule, "2026-01-01", "2026-05-31");
  assert.deepEqual(occ, ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
});

// --- Importi italiani (segnalazione r4 #4): i formati che prima si leggevano male ---
test("importi scritti a mano: migliaia e decimali italiani, testo non valido = null (mai 0 in silenzio)", () => {
  assert.equal(parseDecimalIT("1.234,56"), 1234.56);
  assert.equal(parseDecimalIT("1.200"), 1200);
  assert.equal(parseDecimalIT("12,50"), 12.5);
  assert.equal(parseDecimalIT("12,"), 12);
  assert.equal(parseDecimalIT("abc"), null);
  assert.equal(parseDecimalIT(""), null);
});
