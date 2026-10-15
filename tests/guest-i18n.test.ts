import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { asGuestLang, pickGuestUiLang, translate, fillVars, dateLocale, browserGuestLang, GUEST_LANGS } = await import("../src/lib/guest-i18n.ts");
const { GUEST_DICT } = await import("../src/lib/guest-i18n-dict.ts");

test("lingue supportate: it · en · fr · de · es", () => {
  assert.deepEqual(GUEST_LANGS.map((l) => l.code), ["it", "en", "fr", "de", "es"]);
  assert.equal(asGuestLang("en-GB"), "en");
  assert.equal(asGuestLang("FR"), "fr");
  assert.equal(asGuestLang("de_AT"), "de");
  assert.equal(asGuestLang("pt"), null);
  assert.equal(asGuestLang(""), null);
  assert.equal(asGuestLang(undefined), null);
});

test("lingua di apertura: scelta a mano > ?lang= > prenotazione (prefisso) > browser > italiano", () => {
  assert.equal(pickGuestUiLang({ stored: "de", param: "en", detected: "fr", browser: "es" }), "de");
  assert.equal(pickGuestUiLang({ param: "en", detected: "fr", browser: "es" }), "en");
  assert.equal(pickGuestUiLang({ detected: "fr", browser: "es" }), "fr");
  assert.equal(pickGuestUiLang({ detected: null, browser: "es" }), "es");
  assert.equal(pickGuestUiLang({}), "it");
  assert.equal(pickGuestUiLang({ stored: "xx", detected: "en" }), "en"); // valore non valido ignorato
});

test("lingua del browser: la prima supportata dell'elenco", () => {
  assert.equal(browserGuestLang(["pt-BR", "fr-CH", "en"]), "fr");
  assert.equal(browserGuestLang(["ja"]), null);
  assert.equal(browserGuestLang(undefined), null);
});

test("traduzione: chiave italiana → lingua; mancante → italiano; segnaposto riempiti ovunque", () => {
  assert.equal(translate(GUEST_DICT, "it", "Indietro"), "Indietro");
  assert.equal(translate(GUEST_DICT, "en", "Indietro"), "Back");
  assert.equal(translate(GUEST_DICT, "fr", "Indietro"), "Retour");
  assert.equal(translate(GUEST_DICT, "de", "Indietro"), "Zurück");
  assert.equal(translate(GUEST_DICT, "es", "Indietro"), "Atrás");
  assert.equal(translate(GUEST_DICT, "en", "Testo che non esiste"), "Testo che non esiste");
  assert.equal(translate(GUEST_DICT, "it", "Paga ora {amount}", { amount: "€ 50" }), "Paga ora € 50");
  assert.equal(translate(GUEST_DICT, "de", "Paga ora {amount}", { amount: "€ 50" }), "Jetzt € 50 bezahlen");
  assert.equal(fillVars("a {x} b {y}", { x: 1 }), "a 1 b {y}");
  assert.equal(dateLocale("en"), "en-GB");
});

const SRC = ["../src/app/checkin/page.tsx", "../src/app/gestisci/page.tsx"].map((p) => readFileSync(new URL(p, import.meta.url), "utf8"));
const lit = String.raw`"((?:[^"\\]|\\.)*)"`;
function keysOf(src: string): string[] {
  const out = new Set<string>();
  for (const re of [new RegExp(String.raw`\bt\(\s*` + lit, "g"), new RegExp(String.raw`\bk:\s*` + lit, "g"), new RegExp(String.raw`set(?:LoadErr|ExtractMsg|Err)\(\s*` + lit, "g")]) {
    for (const m of src.matchAll(re)) if (m[1]) out.add(JSON.parse(`"${m[1]}"`));
  }
  return [...out];
}
// Stringhe italiane che arrivano alla t() da variabili/ternari (non sono letterali dentro t("…")): elenco esplicito.
const INDIRECT = ["Non lo so", "dopo le 20:00", "Carta d'identità", "Passaporto", "Patente di guida", "Prenotazione non trovata.", "Impossibile caricare la prenotazione.", "Riprova tra un istante.", "Annullamento non riuscito.", "Indica le nuove date o scrivi un messaggio.", "Invio non riuscito.", "Errore di rete.", "Link non valido.", "Hai inserito {entered} persona su {total}. Per legge servono i dati di tutti gli ospiti (anche dei bambini): torna al passo 1 e usa «＋ Aggiungi».", "Hai inserito {entered} persone su {total}. Per legge servono i dati di tutti gli ospiti (anche dei bambini): torna al passo 1 e usa «＋ Aggiungi»."];

test("ogni stringa delle pagine ospite (check-in e gestisci) ha le traduzioni in en/fr/de/es", () => {
  const missing: string[] = [];
  for (const k of [...SRC.flatMap(keysOf), ...INDIRECT]) {
    const tr = GUEST_DICT[k];
    if (!tr || tr.length !== 4 || tr.some((x: string) => !x.trim())) missing.push(k);
  }
  assert.deepEqual(missing, []);
});

test("i segnaposto {nome} sono gli stessi in tutte le lingue", () => {
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  const bad: string[] = [];
  for (const [k, tr] of Object.entries(GUEST_DICT) as [string, readonly string[]][]) {
    for (const x of tr) if (ph(x) !== ph(k)) bad.push(`${k} → ${x}`);
  }
  assert.deepEqual(bad, []);
});

test("nel dizionario non ci sono chiavi inutilizzate dalle pagine (per non accumulare traduzioni morte)", () => {
  const used = new Set([...SRC.flatMap(keysOf), ...INDIRECT]);
  const unused = Object.keys(GUEST_DICT).filter((k) => !used.has(k));
  assert.deepEqual(unused, []);
});
