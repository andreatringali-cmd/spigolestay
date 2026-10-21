import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const C = await import("../src/lib/ota-composer.ts");
const TR = await import("../src/lib/ai/concierge-translate.ts");
const DR = await import("../src/lib/ai/concierge-draft.ts");

const tpl = (o: Record<string, unknown>) => ({ id: "x", name: "Modello", texts: { it: "Ciao {ospite}" }, ...o }) as any;

test("templatesForStructure: solo la struttura giusta, niente vuoti, ordine dei passaggi poi per nome", () => {
  const all = [
    tpl({ id: "z", name: "Zeta", structureIds: ["s1"] }),
    tpl({ id: "co", name: "Check-out e recensione", srcId: "checkout", structureIds: ["s1"] }),
    tpl({ id: "ci", name: "Check-in online", srcId: "selfcheckin", structureIds: ["s1"] }),
    tpl({ id: "pay", name: "Pagamento", srcId: "pay", structureIds: ["s1"], texts: { it: "Paga {importo}: {link_pagamento}" } }),
    tpl({ id: "altra", name: "Altra struttura", structureIds: ["s2"] }),
    tpl({ id: "vuoto", name: "Vuoto", structureIds: ["s1"], texts: { it: "  ", en: "" } }),
    tpl({ id: "tutte", name: "Per tutte" }),                       // senza structureIds = valido ovunque
    tpl({ id: "senzanome", name: " ", structureIds: ["s1"] }),
    tpl({ id: "alfa", name: "Alfa", structureIds: ["s1"] }),
  ];
  const out = C.templatesForStructure(all, "s1");
  assert.deepEqual(out.map((o: any) => o.tpl.id), ["ci", "pay", "co", "alfa", "tutte", "z"]);
  assert.equal(out.find((o: any) => o.tpl.id === "pay").needsPaymentLink, true);
  assert.equal(out.find((o: any) => o.tpl.id === "ci").needsPaymentLink, false);
  assert.deepEqual(C.templatesForStructure(all, "s2").map((o: any) => o.tpl.id), ["altra", "tutte"]);
  assert.deepEqual(C.templatesForStructure(all, "sconosciuta").map((o: any) => o.tpl.id), ["tutte"]);
});

test("templateTextLang: lingua dell'ospite, poi italiano, poi la prima scritta", () => {
  const t = tpl({ texts: { it: "Ciao", en: "Hi", de: " " } });
  assert.equal(C.templateTextLang(t, "en"), "en");
  assert.equal(C.templateTextLang(t, "de"), "it");      // tedesco vuoto → italiano
  assert.equal(C.templateTextLang(t, "fr"), "it");
  assert.equal(C.templateTextLang(tpl({ texts: { en: "Hi" } }), "es"), "en");
  assert.equal(C.templateTextLang(tpl({ texts: {} }), "it"), "it");
});

test("replyLang: se l'ospite scrive chiaramente in una lingua vince il testo, poi la scheda, poi l'italiano", () => {
  const g = (text: string) => ({ sender: "guest", text });
  assert.equal(C.replyLang(undefined, [g("Hello, what time is check in? Can we leave our luggage?")]), "en");
  assert.equal(C.replyLang("de", [g("ok")]), "de");                                         // testo senza indizi → scheda ospite
  assert.equal(C.replyLang("it", [g("Hello, what is the wifi password and where is the parking?")]), "en"); // scheda «it» di default, testo inglese chiaro
  assert.equal(C.replyLang(undefined, []), "it");                                           // niente dati → italiano
  assert.equal(C.replyLang("ru", [g("ok")]), "en");                                         // lingua non gestita → inglese
  // i messaggi della struttura e di sistema non contano
  assert.equal(C.replyLang(undefined, [{ sender: "property", text: "Hello thanks you can come at the check in" }, g("")]), "it");
});

test("needsTranslation: non per l'italiano o i messaggi brevissimi", () => {
  assert.equal(C.needsTranslation("Buongiorno, a che ora possiamo fare il check-in? Grazie"), false);
  assert.equal(C.needsTranslation("ok"), false);
  assert.equal(C.needsTranslation("Hello, we arrive around 6 pm, can we check in?"), true);
  assert.equal(C.needsTranslation("Guten Tag, wir haben eine Frage zum Parkplatz bitte"), true);
  assert.equal(C.needsTranslation("Здравствуйте, мы приедем вечером"), true);               // alfabeto non latino
  assert.equal(C.needsTranslation("Dzień dobry, kiedy możemy się zameldować?"), true);      // lingua non riconosciuta, testo non breve
});

test("otaRisks: link, email, telefono, WhatsApp, pagamenti, carta; date e orari no", () => {
  assert.deepEqual(C.otaRisks("Ciao Anna, ti aspettiamo il 19.10.2026 alle 15:00. Camera 2, codice 1313."), []);
  assert.deepEqual(C.otaRisks("Guida: https://xenora.it/g/abc123"), ["link"]);
  assert.deepEqual(C.otaRisks("scrivimi a mario@example.com"), ["email"]);
  assert.deepEqual(C.otaRisks("chiamami al +39 333 123 4567"), ["phone"]);
  assert.deepEqual(C.otaRisks("Scrivici su WhatsApp"), ["chat"]);
  assert.ok(C.otaRisks("Puoi pagare con bonifico, IBAN IT60X0542811101000000123456").includes("payment"));
  const card = C.otaRisks("la mia carta 4111 1111 1111 1111 scade a 12/28");
  assert.ok(card.includes("card") && !card.includes("phone"));
  const both = C.otaRisks("chiama +39 333 123 4567, carta 4111 1111 1111 1111");
  assert.ok(both.includes("card") && both.includes("phone"));
  assert.equal(C.otaRiskList(["link", "phone"]), "link, numeri di telefono");
});

test("counterState: nascosto fino all'80%, avviso al 90%, oltre il limite blocca", () => {
  assert.equal(C.counterState(0), "hidden");
  assert.equal(C.counterState(3199), "hidden");
  assert.equal(C.counterState(3200), "ok");
  assert.equal(C.counterState(3600), "warn");
  assert.equal(C.counterState(4000), "warn");
  assert.equal(C.counterState(4001), "over");
});

test("bozza per conversazione: salva, ripristina, scade, cancella se vuota, non lancia", () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
  const now = 1_000_000;
  assert.deepEqual(C.loadDraft(st, "t1", now), { text: "", ai: false });
  C.saveDraft(st, "t1", "Ciao, grazie!", true, now);
  assert.deepEqual(C.loadDraft(st, "t1", now + 1000), { text: "Ciao, grazie!", ai: true });
  assert.deepEqual(C.loadDraft(st, "t2", now), { text: "", ai: false });                      // un'altra conversazione non vede la bozza
  C.saveDraft(st, "t1", "Solo testo", false, now);
  assert.equal(C.loadDraft(st, "t1", now).ai, false);
  assert.deepEqual(C.loadDraft(st, "t1", now + C.OTA_DRAFT_TTL_MS + 1), { text: "", ai: false }); // scaduta
  assert.equal(m.size, 0);                                                                     // e rimossa
  C.saveDraft(st, "t1", "abc", false, now); C.saveDraft(st, "t1", "   ", false, now);
  assert.equal(m.size, 0);                                                                     // vuota = cancellata
  m.set(C.OTA_DRAFT_PREFIX + "t3", "{rotto"); assert.deepEqual(C.loadDraft(st, "t3"), { text: "", ai: false });
  const boom = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
  assert.deepEqual(C.loadDraft(boom, "t1"), { text: "", ai: false });
  assert.doesNotThrow(() => C.saveDraft(boom, "t1", "abc"));
  assert.doesNotThrow(() => C.saveDraft(null, "t1", "abc"));
});

test("traduzione: risposta del modello in JSON, un testo per ogni ingresso", () => {
  assert.deepEqual(TR.parseTextsResponse('qui: {"texts":["Ciao","Grazie"]} fine', 2), ["Ciao", "Grazie"]);
  assert.equal(TR.parseTextsResponse('{"texts":["Ciao"]}', 2), null);          // numero sbagliato
  assert.equal(TR.parseTextsResponse('{"texts":["Ciao",""]}', 2), null);       // vuoto
  assert.equal(TR.parseTextsResponse("nessun json", 1), null);
  const p = TR.buildTextsPrompt("en", ["Buongiorno {x}"], "send");
  assert.ok(p.includes("inglese") && p.includes("Buongiorno") && p.includes("NON tradurre"));
  assert.ok(TR.buildTextsPrompt("it", ["Hello"], "read").includes("italiano"));
});

test("bozza AI: il prompt porta lingua, dati, regole dei portali e l'ultimo messaggio", () => {
  const p = DR.buildDraftPrompt({ lang: "de", structureName: "Casa Bella", guestName: "Anna", stay: "dal 19.10.2026 al 23.10.2026", checkInFrom: "15:00", lastGuestMessage: "Wann ist der Check-in?", transcript: "Ospite: Wann ist der Check-in?", faq: [{ topic: "Parcheggio", answer: "Gratuito in strada" }], hasBooking: true });
  assert.ok(p.includes("tedesco") && p.includes("Casa Bella") && p.includes("dal 19.10.2026") && p.includes("dalle 15:00"));
  assert.ok(p.includes("Gratuito in strada") && p.includes("NON inserire link esterni") && p.includes("Wann ist der Check-in?"));
  assert.ok(!p.includes("NON scrivere password"));
  const q = DR.buildDraftPrompt({ lang: "en", lastGuestMessage: "wifi?", hasBooking: false });
  assert.ok(q.includes("NON scrivere password Wi-Fi"));
});
