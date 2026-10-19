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
  assert.equal(translate(GUEST_DICT, "it", "Ciao {name}!", { name: "Anna" }), "Ciao Anna!");
  assert.equal(translate(GUEST_DICT, "de", "Ciao {name}!", { name: "Anna" }), "Hallo Anna!");
  assert.equal(fillVars("a {x} b {y}", { x: 1 }), "a 1 b {y}");
  assert.equal(dateLocale("en"), "en-GB");
});

const SRC = ["../src/app/checkin/page.tsx", "../src/app/gestisci/page.tsx", "../src/app/prenota/page.tsx", "../src/app/preventivo/page.tsx"].map((p) => readFileSync(new URL(p, import.meta.url), "utf8"));
const lit = String.raw`"((?:[^"\\]|\\.)*)"`;
function keysOf(src: string): string[] {
  const out = new Set<string>();
  for (const re of [new RegExp(String.raw`\bt\(\s*` + lit, "g"), new RegExp(String.raw`\bk:\s*` + lit, "g"), new RegExp(String.raw`set(?:LoadErr|ExtractMsg|Err)\(\s*` + lit, "g")]) {
    for (const m of src.matchAll(re)) if (m[1]) out.add(JSON.parse(`"${m[1]}"`));
  }
  return [...out];
}
// Stringhe italiane che arrivano alla t() da variabili/ternari (non sono letterali dentro t("…")): elenco esplicito.
const INDIRECT = ["Non lo so", "dopo le 20:00", "Carta d'identità", "Passaporto", "Patente di guida", "Permesso di soggiorno", "Prenotazione non trovata.", "Impossibile caricare la prenotazione.", "Riprova tra un istante.", "Annullamento non riuscito.", "Indica le nuove date o scrivi un messaggio.", "Invio non riuscito.", "Errore di rete.", "Link non valido.", "Hai inserito {entered} persona su {total}. Per legge servono i dati di tutti gli ospiti (anche dei bambini): torna al passo 1 e usa «＋ Aggiungi».", "Hai inserito {entered} persone su {total}. Per legge servono i dati di tutti gli ospiti (anche dei bambini): torna al passo 1 e usa «＋ Aggiungi».",
  // /gestisci: errori delle API di annullamento e spiegazioni del pulsante "Annulla" (arrivano da una tabella/variabile)
  "Questa prenotazione non può essere annullata da qui: contatta la struttura.", "Il soggiorno è già iniziato o concluso: contatta la struttura.", "Rimborso non disponibile al momento: riprova più tardi o contatta la struttura.", "Non siamo riusciti a rimborsare il pagamento, quindi la prenotazione NON è stata annullata. Riprova tra qualche minuto o contatta la struttura.", "Troppi tentativi ravvicinati. Attendi un minuto e riprova.", "Questa prenotazione è già stata annullata.", "Il soggiorno è già iniziato o concluso: per qualsiasi modifica contatta la struttura.", "Questa prenotazione è stata fatta tramite un portale (es. Booking.com, Airbnb): per annullarla usa il portale o contatta la struttura.",
  // /prenota: testi dei piani tariffari, messaggi di lib/booking-errors.ts e della ricerca (arrivano da variabili/ternari)
  "adulto", "bambino", "Flessibile", "Non rimborsabile", "Lunga permanenza", "Colazione", "Solo pernottamento", "Mezza pensione", "Pensione completa", "tariffa non rimborsabile",
  "Le date selezionate non sono più disponibili: qualcun altro ha appena prenotato. Scegli altre date o un'altra camera e riprova.", "Le date scelte non sono valide per la prenotazione online. Controlla arrivo e partenza e riprova.", "Il prezzo è cambiato: ricarica la pagina, verifica di nuovo la disponibilità e riprova.", "Questa struttura non accetta prenotazioni online al momento. Contatta direttamente la struttura.", "Non è stato possibile completare la prenotazione. Nessun addebito è stato effettuato e la prenotazione non è stata registrata. Riprova tra poco o contatta la struttura.", "Connessione assente o instabile: la prenotazione non è stata registrata. Controlla la connessione e riprova.",
  // /preventivo: motivi per cui non si può pagare e errori del server (arrivano da variabili)
  "Questo preventivo risulta già confermato e pagato.", "Questo preventivo è scaduto: chiedi alla struttura un nuovo link.", "Questo preventivo non prevede un pagamento online: l'importo si salda direttamente in struttura.", "Preventivo non trovato: chiedi alla struttura un nuovo link.", "Preventivo non valido: chiedi alla struttura un nuovo link.", "Impossibile avviare il pagamento."];

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
