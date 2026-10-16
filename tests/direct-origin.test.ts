import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { directOriginOf, directOriginLabel } = await import("../src/lib/direct-origin.ts");

test("prenotazioni nuove: il campo source decide", () => {
  assert.equal(directOriginOf({ channel: "direct", source: "sito" }), "sito");
  assert.equal(directOriginOf({ channel: "direct", source: "manuale" }), "manuale");
  // source esplicito vince sulle tracce (es. una manuale con nota che inizia come il sito)
  assert.equal(directOriginOf({ channel: "direct", source: "manuale", note: "Prenotazione dal sito", code: "SPG-2026-1" }), "manuale");
  assert.equal(directOriginOf({ channel: "direct", source: "sito", code: "XEN-2026-0001" }), "sito");
});

test("vecchie dal sito: riconosciute dalle tracce del booking engine", () => {
  assert.equal(directOriginOf({ channel: "direct", extId: "site:mia-struttura:abc-123" }), "sito");
  assert.equal(directOriginOf({ channel: "direct", stripePaymentIntent: "pi_123" }), "sito");
  assert.equal(directOriginOf({ channel: "direct", stripeSessionId: "cs_123" }), "sito");
  assert.equal(directOriginOf({ channel: "direct", stripeAccountId: "acct_1" }), "sito");
  assert.equal(directOriginOf({ channel: "direct", code: "SPG-2026-48213" }), "sito");
  assert.equal(directOriginOf({ channel: "direct", note: "Prenotazione dal sito" }), "sito");
  assert.equal(directOriginOf({ channel: "direct", note: "Prenotazione dal sito · ⚠ nessuna camera libera in quelle date: da assegnare a mano" }), "sito");
  assert.equal(directOriginOf({ channel: "direct", note: "Sito diretto · Flessibile · Arrivo ~15:00" }), "sito");
  assert.equal(directOriginOf({ channel: "direct", ratePlanName: "Non rimborsabile" }), "sito");
});

test("vecchie manuali: nessuna traccia del sito → manuale", () => {
  assert.equal(directOriginOf({ channel: "direct" }), "manuale");
  assert.equal(directOriginOf({ channel: "direct", code: "XEN-2026-0007" }), "manuale");
  assert.equal(directOriginOf({ channel: "direct", note: "Telefonata, passaparola", extId: "stripe:cs_live_1" }), "manuale"); // preventivo pagato dal link: fatto dal gestionale
  assert.equal(directOriginOf({ channel: "direct", extId: "ical-uid-123@octorate.com", code: "ABC123" }), "manuale"); // import iCal: ripiego
  assert.equal(directOriginOf({ channel: "direct", stripePaymentIntent: "", stripeSessionId: undefined, ratePlanName: "  " }), "manuale"); // campi vuoti non contano
  assert.equal(directOriginOf({ channel: "direct", note: "Chiamato il sito dell'hotel per info" }), "manuale"); // "sito" a metà frase non basta
  assert.equal(directOriginOf({ channel: "direct", code: "SPG-ABC" }), "manuale"); // forma del codice diversa da quella del booking engine
});

test("OTA, Channex e blocchi non vengono toccati", () => {
  for (const channel of ["booking", "airbnb", "expedia", "agoda", "google", "hotelbeds", "other", "blocked"]) {
    assert.equal(directOriginOf({ channel }), null);
    // anche se, per errore, avessero tracce da sito o source impostato: il canale non è "Diretta"
    assert.equal(directOriginOf({ channel, source: "sito", extId: "site:x:y", stripePaymentIntent: "pi_1" }), null);
  }
  assert.equal(directOriginOf({ channel: "booking", extId: "channex:abc" }), null);
  assert.equal(directOriginOf(null), null);
  assert.equal(directOriginOf(undefined), null);
});

test("etichette del tooltip", () => {
  assert.equal(directOriginLabel("sito", "Spigole House"), "Sito ufficiale · Spigole House");
  assert.equal(directOriginLabel("sito"), "Sito ufficiale");
  assert.equal(directOriginLabel("manuale", "Spigole House"), "Diretta · inserita a mano");
});
