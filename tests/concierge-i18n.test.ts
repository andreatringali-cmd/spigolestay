import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLang, detectLang, pickGuestLang, srcHashOf, protectedTokens, validateTranslation, parseTranslations, toTranslationMap,
  translationState, pickMasters, pickTranslatedGroup, parseTranslateResponse, chunk, tKey, TRANSLATIONS_KEY, type TranslationItem,
} from "../src/lib/concierge-i18n.ts";

type E = Parameters<typeof pickMasters>[0][number];
const entry = (o: Partial<E> & { id: string }): E => ({
  level: "shared", property_id: null, category: "servizi", field_type: "editorial", auto_source: null,
  title: "Titolo", body: "Testo", lang: "it", sort_order: 1, ...o,
} as E);

// --- lingua ---------------------------------------------------------------------------------------------------------
test("normalizeLang: codici, nomi, regioni, lingue non supportate", () => {
  assert.equal(normalizeLang("de"), "de");
  assert.equal(normalizeLang("DE-de"), "de");
  assert.equal(normalizeLang("Deutsch"), "de");
  assert.equal(normalizeLang("français"), "fr");
  assert.equal(normalizeLang("Español"), "es");
  assert.equal(normalizeLang("tedesco"), "de");
  assert.equal(normalizeLang("ru"), "other");
  assert.equal(normalizeLang(""), "");
  assert.equal(normalizeLang(undefined), "");
});

test("pickGuestLang: anagrafica, testo, ripiego", () => {
  assert.equal(pickGuestLang("de", "wifi?"), "de");
  assert.equal(pickGuestLang("fr", ""), "fr");
  assert.equal(pickGuestLang("es", undefined), "es");
  assert.equal(pickGuestLang("ru", "wifi?"), "en");        // lingua non supportata -> inglese
  assert.equal(pickGuestLang(undefined, "Ciao, a che ora è la colazione?"), "it");
  assert.equal(pickGuestLang(undefined, "What time is breakfast, please?"), "en");
  assert.equal(pickGuestLang(undefined, "Wie ist das WLAN Passwort bitte?"), "de");
  assert.equal(pickGuestLang(undefined, "Bonjour, nous avons une question sur le parking"), "fr");
  assert.equal(pickGuestLang(undefined, "Hola, donde esta el desayuno por favor?"), "es");
  assert.equal(pickGuestLang(undefined, ""), "it");
  assert.equal(pickGuestLang(undefined, "ok"), "it");
});

test("pickGuestLang: l'anagrafica 'it' predefinita non batte un testo chiaramente tedesco; un testo ambiguo no", () => {
  assert.equal(pickGuestLang("it", "Guten Tag, wie ist das Passwort für das WLAN?"), "de");
  assert.equal(pickGuestLang("it", "Wifi?"), "it");
  assert.equal(pickGuestLang("en", "Parking?"), "en");
  assert.equal(detectLang("zzz").lang, null);
});

// --- token intoccabili ---------------------------------------------------------------------------------------------
test("protectedTokens: link, email, numeri, codici, password, segnaposto", () => {
  const t = protectedTokens("Codice {{value}}. Rete: SPIGOLE_GUEST, password: Casa2024! Scrivi a info@x.it o https://wa.me/393293071740. Check-in alle 15:00, portone 1313#.");
  assert.equal(t.placeholders, 1);
  assert.deepEqual(t.urls, ["https://wa.me/393293071740"]);
  assert.deepEqual(t.emails, ["info@x.it"]);
  assert.ok(t.codes.includes("SPIGOLE_GUEST"));
  assert.ok(t.codes.includes("Casa2024"));
  assert.ok(t.codes.includes("1313#"));
  assert.ok(t.nums.includes("15") && t.nums.includes("00"));
});

test("validateTranslation: traduzione corretta passa", () => {
  const src = { title: "Codice d'accesso", body: "Il tuo codice è {{value}}. Per assistenza chiama +39 329 307 1740 o apri https://wa.me/393293071740 (Via Roma 12)." };
  const tr = { title: "Zugangscode", body: "Dein Code lautet {{value}}. Für Hilfe ruf +39 329 307 1740 an oder öffne https://wa.me/393293071740 (Via Roma 12)." };
  assert.deepEqual(validateTranslation(src, tr), { ok: true, errors: [] });
});

test("validateTranslation: segnaposto perso o raddoppiato -> scartata", () => {
  const src = { title: "Codice", body: "Il codice è {{value}}" };
  assert.equal(validateTranslation(src, { title: "Code", body: "Der Code ist bekannt" }).ok, false);
  assert.equal(validateTranslation(src, { title: "Code", body: "Der Code ist {{value}} {{value}}" }).ok, false);
  assert.equal(validateTranslation(src, { title: "Code", body: "Der Code ist {{ value }}" }).ok, true); // stessa cosa per il render
  assert.equal(validateTranslation(src, { title: "Code", body: "Der Code ist {{altro}}" }).ok, false);
});

test("validateTranslation: link, telefono, orario, codice, password alterati -> scartata", () => {
  const src = { title: "Wi-Fi", body: "Rete: SPIGOLE_GUEST, password: pizza2024. Apri https://maps.app.goo.gl/abc123 o chiama 0931 123456. Colazione dalle 8:00." };
  const ok = { title: "WLAN", body: "Netz: SPIGOLE_GUEST, Passwort: pizza2024. Öffne https://maps.app.goo.gl/abc123 oder ruf 0931 123456 an. Frühstück ab 8:00." };
  assert.equal(validateTranslation(src, ok).ok, true);
  const badUrl = validateTranslation(src, { ...ok, body: ok.body.replace("abc123", "abc124") });
  assert.equal(badUrl.ok, false);
  assert.match(badUrl.errors.join(" "), /link/);
  assert.equal(validateTranslation(src, { ...ok, body: ok.body.replace("123456", "123457") }).ok, false);
  assert.equal(validateTranslation(src, { ...ok, body: ok.body.replace("8:00", "9:00") }).ok, false);
  assert.equal(validateTranslation(src, { ...ok, body: ok.body.replace("SPIGOLE_GUEST", "SPIGOLE-GAST") }).ok, false);
  assert.equal(validateTranslation(src, { ...ok, body: ok.body.replace("pizza2024", "Pizza2024") }).ok, false);
});

test("validateTranslation: password in minuscolo dopo 'password:' e link/numeri aggiunti dall'AI", () => {
  const src = { title: "Wi-Fi", body: "password: pizzamargherita" };
  assert.equal(validateTranslation(src, { title: "WLAN", body: "Passwort: Pizza-Margherita" }).ok, false);
  assert.equal(validateTranslation(src, { title: "WLAN", body: "Passwort: pizzamargherita" }).ok, true);
  assert.equal(validateTranslation(src, { title: "WLAN", body: "Passwort: pizzamargherita, Hilfe 0931123456" }).ok, false); // numero lungo inventato
  assert.equal(validateTranslation(src, { title: "WLAN", body: "Passwort: pizzamargherita https://evil.example" }).ok, false);
  assert.equal(validateTranslation(src, { title: "", body: "x" }).ok, false);
});

// --- impronta e stato ---------------------------------------------------------------------------------------------
test("impronta: cambia se cambia titolo/testo/tipo, non se cambiano telefono o ordine", () => {
  const a = entry({ id: "1", title: "Colazione", body: "Dalle 8" });
  assert.equal(srcHashOf(a), srcHashOf({ ...a, title: " Colazione ", body: "Dalle 8 " }));
  assert.notEqual(srcHashOf(a), srcHashOf({ ...a, body: "Dalle 9" }));
  assert.notEqual(srcHashOf(a), srcHashOf({ ...a, title: "Colazione!" }));
  assert.equal(srcHashOf(a), srcHashOf({ ...a, phone: "+39", sort_order: 9 } as E));
});

const item = (e: E, lang: "de" | "fr" | "es", o: Partial<TranslationItem> = {}): TranslationItem =>
  ({ id: e.id!, lang, title: "T-" + lang, body: "B-" + lang, ts: 1, reviewed: false, srcHash: srcHashOf(e), srcLang: e.lang, ...o });

test("translationState: mancante / da rivedere / rivista / da aggiornare", () => {
  const e = entry({ id: "1" });
  assert.equal(translationState(e, undefined), "missing");
  assert.equal(translationState(e, item(e, "de")), "draft");
  assert.equal(translationState(e, item(e, "de", { reviewed: true })), "reviewed");
  const changed = { ...e, body: "Testo nuovo" };
  assert.equal(translationState(changed, item(e, "de", { reviewed: true })), "stale"); // l'originale è cambiato dopo la traduzione
});

test("parseTranslations: forma {v,items} o array, scarta righe malformate; la chiave non ha prefissi sincronizzati", () => {
  const e = entry({ id: "1" });
  const good = item(e, "fr");
  assert.equal(parseTranslations(JSON.stringify({ v: 1, items: [good, { id: 3 }, null, { ...good, lang: "ru" }] })).length, 1);
  assert.equal(parseTranslations([good]).length, 1);
  assert.equal(parseTranslations("non json").length, 0);
  assert.equal(parseTranslations(undefined).length, 0);
  assert.ok(!TRANSLATIONS_KEY.startsWith("spigolestay:") && !TRANSLATIONS_KEY.startsWith("xenora:"));
});

// --- selezione voci --------------------------------------------------------------------------------------------------
test("pickMasters: italiano; l'inglese solo se non ha il gemello italiano", () => {
  const it1 = entry({ id: "it1", category: "wifi", lang: "it" });
  const en1 = entry({ id: "en1", category: "wifi", lang: "en" });            // gemello di it1 -> escluso
  const en2 = entry({ id: "en2", category: "cibo", lang: "en" });            // nessun italiano nel gruppo -> master
  const autoIt = entry({ id: "ai", category: "accesso", field_type: "auto", auto_source: "access_code", body: "{{value}}" });
  const autoEn = entry({ id: "ae", category: "accesso", field_type: "auto", auto_source: "access_code", body: "{{value}}", lang: "en" });
  const m = pickMasters([it1, en1, en2, autoIt, autoEn]).map((e) => e.id).sort();
  assert.deepEqual(m, ["ai", "en2", "it1"]);
});

test("pickTranslatedGroup: traduzione aggiornata, poi inglese, poi italiano; mai una traduzione da aggiornare", () => {
  const it1 = entry({ id: "a", title: "Colazione", body: "Dalle 8", sort_order: 1 });
  const en1 = entry({ id: "a-en", title: "Breakfast", body: "From 8", lang: "en", sort_order: 1 });
  const it2 = entry({ id: "b", title: "Parcheggio", body: "Gratis", sort_order: 2 });
  const group = [it1, en1, it2];

  // nessuna traduzione: a -> inglese (gemello), b -> italiano
  let r = pickTranslatedGroup(group, "de", new Map());
  assert.deepEqual(r.map((e) => e.id), ["a-en", "b"]);

  // a tradotta e aggiornata -> usata; b mancante -> italiano
  const tr = toTranslationMap([item(it1, "de", { title: "Frühstück", body: "Ab 8" })]);
  r = pickTranslatedGroup(group, "de", tr);
  assert.equal(r[0].title, "Frühstück");
  assert.equal(r[0].id, "a");
  assert.equal(r[1].id, "b");
  assert.equal(r[1].title, "Parcheggio");

  // la lingua giusta: la traduzione tedesca non si usa per il francese
  assert.equal(pickTranslatedGroup(group, "fr", tr)[0].id, "a-en");

  // originale cambiato dopo la traduzione -> la traduzione vecchia NON si usa (potrebbe avere dati vecchi)
  const changed = group.map((e) => (e.id === "a" ? { ...e, body: "Dalle 9" } : e));
  r = pickTranslatedGroup(changed, "de", tr);
  assert.equal(r[0].id, "a-en");
  assert.ok(!r.some((e) => e.title === "Frühstück"));
});

test("pickTranslatedGroup: la voce AUTO tradotta conserva {{value}}, sorgente e categoria (restano visibili solo con prenotazione)", () => {
  const auto = entry({ id: "ac", category: "accesso", field_type: "auto", auto_source: "access_code", title: "Codice", body: "Il codice è {{value}}" });
  const tr = toTranslationMap([item(auto, "es", { title: "Código", body: "El código es {{value}}" })]);
  const [r] = pickTranslatedGroup([auto], "es", tr);
  assert.equal(r.body, "El código es {{value}}");
  assert.equal(r.auto_source, "access_code");
  assert.equal(r.category, "accesso");
});

// --- risposta AI --------------------------------------------------------------------------------------------------
test("parseTranslateResponse e chunk", () => {
  const txt = 'Ecco:\n```json\n{"items":[{"id":"a","title":" T ","body":"B"},{"id":"zzz","title":"x","body":"y"},{"id":"b","title":1,"body":"y"}]}\n```';
  const m = parseTranslateResponse(txt, ["a", "b", "c"]);
  assert.deepEqual([...m.keys()], ["a"]);
  assert.equal(m.get("a")!.title, "T");
  assert.equal(parseTranslateResponse("niente json", ["a"]).size, 0);
  assert.equal(parseTranslateResponse("{rotto", ["a"]).size, 0);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(tKey("x", "de"), "x|de");
});

test("gemello inglese: per posizione solo se i conteggi coincidono, mai abbinamenti incerti", () => {
  const i1 = entry({ id: "i1", sort_order: 1 }), i2 = entry({ id: "i2", sort_order: 2 });
  const e1 = entry({ id: "e1", lang: "en", sort_order: 10 }), e2 = entry({ id: "e2", lang: "en", sort_order: 20 });
  assert.deepEqual(pickTranslatedGroup([i1, i2, e1, e2], "fr", new Map()).map((e) => e.id), ["e1", "e2"]);  // 2 e 2: per posizione
  assert.deepEqual(pickTranslatedGroup([i1, i2, e1], "fr", new Map()).map((e) => e.id), ["i1", "i2"]);      // 2 e 1: ambiguo -> italiano
});
