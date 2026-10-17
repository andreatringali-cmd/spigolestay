import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { EMAIL_DICT, et, emailLang, cancelPolicyIn, cityTaxRuleIn } = await import("../src/lib/email-i18n.ts");

test("lingua dell'email: esplicita > scheda ospite > Paese > prefisso del telefono > italiano", () => {
  assert.equal(emailLang({ lang: "fr", guestLanguage: "de", guestPhone: "+49 170 1" }), "fr");
  assert.equal(emailLang({ guestLanguage: "de", guestPhone: "+33 6 12 34 56 78" }), "de");
  assert.equal(emailLang({ guestCountry: "GB", guestPhone: "+39 333 1234567" }), "en");
  assert.equal(emailLang({ guestPhone: "+33 6 12 34 56 78" }), "fr");
  assert.equal(emailLang({ guestPhone: "0034 600 000 000" }), "es");
  assert.equal(emailLang({ guestPhone: "+1 202 555 0100" }), "en");
  assert.equal(emailLang({ guestPhone: "333 1234567" }), "it");
  assert.equal(emailLang({}), "it");
  assert.equal(emailLang(undefined), "it");
});

test("testi con segnaposto: italiano di partenza e traduzioni", () => {
  assert.equal(et("it", "Ciao <b>{name}</b>,", { name: "Anna" }), "Ciao <b>Anna</b>,");
  assert.equal(et("de", "Ciao <b>{name}</b>,", { name: "Anna" }), "Hallo <b>Anna</b>,");
  assert.equal(et("fr", "Rimborso emesso: {amount}", { amount: "€ 80" }), "Remboursement émis : € 80");
  assert.equal(et("en", "Arrivo"), "Arrival");
  assert.equal(et("en", "No-show"), "No-show"); // senza traduzione resta com'è
});

test("politica di cancellazione dai dati strutturati, in ogni lingua", () => {
  assert.match(cancelPolicyIn("en", false), /non-refundable/);
  assert.match(cancelPolicyIn("de", true, 7), /7 Tage/);
  assert.match(cancelPolicyIn("es", true, 3), /3 días/);
  assert.match(cancelPolicyIn("fr", true, 0), /jusqu'au jour d'arrivée/);
  assert.match(cancelPolicyIn("it", true, 5), /fino a 5 giorni/);
});

test("politica di cancellazione: 1 giorno al singolare in ogni lingua (mai '1 giorni' / '1 days')", () => {
  assert.match(cancelPolicyIn("it", true, 1), /fino a 1 giorno prima/);
  assert.match(cancelPolicyIn("en", true, 1), /up to 1 day before/);
  assert.match(cancelPolicyIn("fr", true, 1), /jusqu'à 1 jour avant/);
  assert.match(cancelPolicyIn("de", true, 1), /bis 1 Tag vor/);
  assert.match(cancelPolicyIn("es", true, 1), /hasta 1 día antes/);
  for (const l of ["it", "en", "fr", "de", "es"] as const) assert.doesNotMatch(cancelPolicyIn(l, true, 1), /\b1 (giorni|days|jours|Tage|días)\b/);
});

test("tassa di soggiorno: percentuale con tetto e bambini, oppure importo fisso", () => {
  const pct = cityTaxRuleIn("en", { mode: "percent", percent: 4, cap: 5, childFreeUnder: 14 });
  assert.match(pct, /4% of the booking/);
  assert.match(pct, /Maximum 5 EUR/);
  assert.match(pct, /under 14/);
  assert.match(pct, /not included in the booking total/);
  const fixed = cityTaxRuleIn("it", { mode: "amount", amount: 2 });
  assert.match(fixed, /2 EUR a persona per notte/);
  assert.doesNotMatch(fixed, /Massimo/);
});

test("ogni T(\"…\") usato dalla route /api/email ha le 4 traduzioni, con gli stessi segnaposto", () => {
  // route + i costruttori delle email (src/lib/mail) + PDF di ripiego: tutti i testi tradotti passano da T()/et()
  const files = ["../src/app/api/email/route.ts", "../src/lib/mail/guest-emails.ts", "../src/lib/mail/shell.ts", "../src/lib/voucher-pdf.ts"];
  const src = files.map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  const lit = String.raw`"((?:[^"\\]|\\.)*)"`;
  const keys = new Set<string>();
  for (const m of src.matchAll(new RegExp(String.raw`\bT\(\s*` + lit, "g"))) keys.add(JSON.parse(`"${m[1]}"`));
  for (const m of src.matchAll(new RegExp(String.raw`\bet\(\s*(?:emailLang\(b\)|L|lang),\s*` + lit, "g"))) keys.add(JSON.parse(`"${m[1]}"`));
  assert.ok(keys.size > 30, `trovate ${keys.size} chiavi`);
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  const bad: string[] = [];
  for (const k of keys) {
    const tr = EMAIL_DICT[k];
    if (!tr || tr.length !== 4 || tr.some((x: string) => !x.trim()) || tr.some((x: string) => ph(x) !== ph(k))) bad.push(k);
  }
  assert.deepEqual(bad, []);
});
