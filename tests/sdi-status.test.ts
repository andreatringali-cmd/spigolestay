import { test } from "node:test";
import assert from "node:assert/strict";
import { sendAction, sendButtonLabel, sendConfirmText, isTrialMessage, isTrialSend, rejectionReason, sdiBadge, unchangedStatusMessage } from "../src/lib/invoicing/sdi-status.ts";

const doc = (o: Partial<{ stato: string; doc_kind: string; send_sdi: boolean; provider: string | null }> = {}) => ({ stato: "emessa", doc_kind: "fattura", send_sdi: true, provider: "fattureincloud", ...o });

test("pulsante invio: emessa con SdI attivo = invia", () => {
  assert.equal(sendAction(doc()), "send");
});

test("pulsante invio: emessa con SdI spento ma provider impostato = attiva e invia", () => {
  assert.equal(sendAction(doc({ send_sdi: false })), "enable_and_send");
  assert.equal(sendAction(doc({ send_sdi: false, doc_kind: "nota_di_credito" })), "enable_and_send");
});

test("pulsante invio: nessun pulsante per bozza, già inviata, ricevuta, senza provider", () => {
  assert.equal(sendAction(doc({ stato: "bozza" })), null);
  assert.equal(sendAction(doc({ stato: "inviata_intermediario" })), null);
  assert.equal(sendAction(doc({ stato: "consegnata", send_sdi: false })), null);
  assert.equal(sendAction(doc({ doc_kind: "ricevuta_non_fiscale", send_sdi: false })), null);
  assert.equal(sendAction(doc({ doc_kind: "ricevuta_non_fiscale" })), null);
  assert.equal(sendAction(doc({ send_sdi: false, provider: null })), null);
});

test("etichetta pulsante e conferma: prova vs invio reale", () => {
  assert.equal(sendButtonLabel("fattureincloud"), "Invia a Fatture in Cloud");
  assert.equal(sendButtonLabel("openapi"), "Invia allo SdI");
  const prova = sendConfirmText({ provider: "fattureincloud", dryRun: true, enableSdi: true, numberLabel: "3/2026" });
  assert.match(prova.message, /prova/i);
  assert.match(prova.message, /NON trasmesso allo SdI/);
  assert.match(prova.message, /verrà attivata ora/);
  const reale = sendConfirmText({ provider: "fattureincloud", dryRun: false, enableSdi: false, numberLabel: "3/2026" });
  assert.match(reale.message, /INVIO REALE/);
  assert.doesNotMatch(reale.message, /attivata ora/);
  const ignoto = sendConfirmText({ provider: "openapi", dryRun: null, enableSdi: false });
  assert.match(ignoto.message, /modalità prova/i);
  for (const t of [prova, reale, ignoto]) assert.doesNotMatch(JSON.stringify(t), /channex/i);
});

test("modalità prova riconosciuta dal messaggio del provider o dal meta dell'evento", () => {
  const msg = "Documento creato in Fatture in Cloud (MODALITÀ PROVA — non inviato allo SdI). Verificalo.";
  assert.equal(isTrialMessage(msg), true);
  assert.equal(isTrialMessage("Fattura creata e trasmessa allo SdI tramite Fatture in Cloud."), false);
  assert.equal(isTrialSend([{ kind: "sent", message: msg }]), true);
  assert.equal(isTrialSend([{ kind: "sent", message: "x", meta: { dry_run: true } }]), true);
  assert.equal(isTrialSend([{ kind: "sent", message: "Fattura creata e trasmessa allo SdI.", meta: { dry_run: false } }]), false);
  assert.equal(isTrialSend([{ kind: "created", message: "Bozza creata" }]), false);
  // Vale l'ultimo invio (eventi dal più recente): prima in prova, poi reale
  assert.equal(isTrialSend([{ kind: "sent", message: "Trasmessa", meta: { dry_run: false } }, { kind: "sent", message: msg }]), false);
});

test("motivo dello scarto", () => {
  assert.equal(rejectionReason([{ kind: "rejected", message: "Scartata dallo SdI: 00300 codice destinatario non valido" }]), "00300 codice destinatario non valido");
  assert.equal(rejectionReason([{ kind: "sent", message: "x" }]), "");
});

test("badge: In prova / Inviata / Consegnata / Scartata", () => {
  const base = (label: string) => ({ label, color: "var(--x)" });
  assert.equal(sdiBadge("inviata_intermediario", true, base("Inviata")).label, "In prova");
  assert.equal(sdiBadge("inviata_intermediario", false, base("Inviata")).label, "Inviata");
  assert.equal(sdiBadge("consegnata", false, base("Consegnata")).label, "Consegnata");
  assert.equal(sdiBadge("scartata", false, base("Scartata")).label, "Scartata");
  assert.equal(sdiBadge("emessa", true, base("Emessa")).label, "Emessa"); // la prova conta solo dopo l'invio
});

test("aggiornamento senza cambio di stato", () => {
  assert.match(unchangedStatusMessage(true, "Stato e-fattura: not_sent"), /in prova, non trasmessa allo SdI/);
  assert.match(unchangedStatusMessage(false, "Stato e-fattura: sent"), /in attesa dell'esito/);
});

test("eventDisplay: accorcia il messaggio di prova e separa l'avviso sul totale", async () => {
  const { eventDisplay } = await import("../src/lib/invoicing/sdi-status.ts");
  const long = "Documento creato in Fatture in Cloud (MODALITÀ PROVA — non inviato allo SdI). Verificalo su Fatture in Cloud, poi disattiva la prova per l'invio reale. Attenzione: Fatture in Cloud calcola un totale di € 83,20 invece di € 85,20 (Xenora): controlla bollo e voci sul documento.";
  const d = eventDisplay(long);
  assert.equal(d.text, "Creato su Fatture in Cloud in prova, non inviato allo SdI.");
  assert.equal(d.warn, "Totale diverso su Fatture in Cloud: € 83,20 invece di € 85,20 (Xenora). Controlla bollo e voci.");
  assert.deepEqual(eventDisplay("Documento emesso n. 2/2026"), { text: "Documento emesso n. 2/2026", warn: undefined });
});
