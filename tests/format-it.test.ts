import test from "node:test";
import assert from "node:assert/strict";
import { eur, num } from "../src/lib/format.ts";
import { plural } from "../src/lib/plural.ts";
import { csvSafe, csvCell, buildCsv } from "../src/lib/invoicing/csv.ts";

test("eur: due decimali, migliaia sempre separate (anche a 4 cifre), € davanti", () => {
  assert.equal(eur(0), "€ 0,00");
  assert.equal(eur(12.5), "€ 12,50");
  assert.equal(eur(999.99), "€ 999,99");
  assert.equal(eur(1234.56), "€ 1.234,56");
  assert.equal(eur(1234567.8), "€ 1.234.567,80");
  assert.equal(eur(-1234.5), "-€ 1.234,50");
});

test("eur: NaN, undefined, null e Infinity diventano € 0,00; -0 e arrotondamenti a zero senza meno", () => {
  for (const v of [NaN, undefined, null, Infinity, -Infinity]) assert.equal(eur(v), "€ 0,00", String(v));
  assert.equal(eur(-0), "€ 0,00");
  assert.equal(eur(-0.004), "€ 0,00");
  assert.equal(eur(-0.006), "-€ 0,01");
});

test("eur: valuta diversa dal simbolo di default", () => {
  assert.equal(eur(1500, "CHF"), "CHF 1.500,00");
});

test("num: intero con migliaia; mai '-0'; valori non numerici = 0", () => {
  assert.equal(num(1234), "1.234");
  assert.equal(num(1234567), "1.234.567");
  assert.equal(num(-0.4), "0");
  assert.equal(num(-1500.4), "-1.500");
  assert.equal(num(NaN), "0");
  assert.equal(num(undefined), "0");
});

test("plural: singolare solo per 1", () => {
  assert.equal(plural(1, "notte", "notti"), "1 notte");
  assert.equal(plural(0, "notte", "notti"), "0 notti");
  assert.equal(plural(2, "notte", "notti"), "2 notti");
  assert.equal(plural(1, "giorno", "giorni"), "1 giorno");
});

test("csvSafe: i testi che iniziano con = + - @ tab non diventano formule; i numeri restano numeri", () => {
  assert.equal(csvSafe("=SOMMA(A1:A2)"), "'=SOMMA(A1:A2)");
  assert.equal(csvSafe("+39 333 1234567"), "'+39 333 1234567");
  assert.equal(csvSafe("@cmd"), "'@cmd");
  assert.equal(csvSafe("-cmd|' /C calc'!A0"), "'-cmd|' /C calc'!A0");
  assert.equal(csvSafe("\tciao"), "'\tciao");
  assert.equal(csvSafe("-12,50"), "-12,50"); // importo negativo scritto come testo
  assert.equal(csvSafe("+393331234567"), "+393331234567");
  assert.equal(csvSafe("-1.234,50"), "-1.234,50"); // importo negativo con migliaia
  assert.equal(csvSafe("-1.234.567,5"), "-1.234.567,5");
  assert.equal(csvSafe("+1.5"), "+1.5");
  assert.equal(csvSafe("-"), "'-");
  assert.equal(csvSafe("-."), "'-.");
  assert.equal(csvSafe("-1.234,50 €"), "'-1.234,50 €"); // non è un numero puro
  assert.equal(csvSafe("-1,2,3"), "'-1,2,3");
  assert.equal(csvSafe(-12.5), "-12.5");
  assert.equal(csvSafe("Mario Rossi"), "Mario Rossi");
  assert.equal(csvSafe(null), "");
});

test("csvCell / buildCsv: celle tra virgolette con la protezione applicata", () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  const csv = buildCsv(["Nome", "Importo"], [["=1+1", "-5,00"], ["Anna", 3]]);
  assert.ok(csv.includes(`"'=1+1";"-5,00"`));
  assert.ok(csv.includes(`"Anna";"3"`));
});
