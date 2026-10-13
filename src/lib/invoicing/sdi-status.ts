// Logica PURA (senza rete né database) per l'invio allo SdI dei documenti emessi e per la lettura dello stato.
// Usata sia dalla scheda documento / elenco (browser) sia dal servizio server, così le regole sono una sola.

export interface SendDocLike { stato: string; doc_kind: string; send_sdi: boolean; provider: string | null }
export interface EventLike { kind: string; message?: string | null; meta?: Record<string, unknown> | null }

/**
 * Quale pulsante di invio mostrare per un documento già emesso.
 * - "send": comunicazione allo SdI già attiva, basta inviare;
 * - "enable_and_send": emesso con la spunta "Comunica al SDI" spenta ma con un provider impostato: prima si attiva, poi si invia;
 * - null: nessun pulsante (bozza, già inviato, ricevuta non fiscale, nessun provider).
 */
export type SendAction = "send" | "enable_and_send" | null;
export function sendAction(d: SendDocLike): SendAction {
  if (d.stato !== "emessa") return null;
  if (d.doc_kind === "ricevuta_non_fiscale") return null;
  if (d.send_sdi) return "send";
  return d.provider ? "enable_and_send" : null;
}

export function providerLabel(provider: string | null | undefined): string {
  if (provider === "fattureincloud") return "Fatture in Cloud";
  if (provider === "openapi") return "Openapi";
  return "l'intermediario";
}

export function sendButtonLabel(provider: string | null | undefined): string {
  return provider === "fattureincloud" ? "Invia a Fatture in Cloud" : "Invia allo SdI";
}

/** Testo della conferma prima dell'invio. dryRun: true = prova, false = invio reale, null = non noto. */
export function sendConfirmText(opts: { provider: string | null | undefined; dryRun: boolean | null; enableSdi: boolean; numberLabel?: string | null }): { title: string; message: string; confirmLabel: string } {
  const who = providerLabel(opts.provider);
  const doc = opts.numberLabel ? `il documento ${opts.numberLabel}` : "il documento";
  const enable = opts.enableSdi ? "Era stato emesso senza comunicazione allo SdI: verrà attivata ora. " : "";
  if (opts.dryRun === true) {
    return {
      title: "Invia in prova",
      message: `${enable}Modalità prova attiva: ${doc} sarà creato su ${who} ma NON trasmesso allo SdI. Per l'invio reale disattiva la prova nelle Impostazioni fattura.`,
      confirmLabel: "Crea in prova",
    };
  }
  if (opts.dryRun === false) {
    return {
      title: "Invia allo SdI",
      message: `${enable}INVIO REALE: ${doc} sarà trasmesso allo SdI tramite ${who}. Dopo l'invio non è più modificabile (per correggere serve una nota di credito).`,
      confirmLabel: "Invia allo SdI",
    };
  }
  return {
    title: "Invia allo SdI",
    message: `${enable}Inviare ${doc} tramite ${who}? Se è attiva la modalità prova non arriverà allo SdI; con l'invio reale non sarà più modificabile.`,
    confirmLabel: "Invia",
  };
}

/** Il messaggio del provider indica un documento creato solo in prova (non trasmesso allo SdI)? */
export function isTrialMessage(msg: string | null | undefined): boolean {
  return /MODALIT[AÀ]\s+PROVA/i.test(msg ?? "");
}

/** Gli eventi sono ordinati dal più recente: vale l'ULTIMO invio (kind "sent"). true = creato solo in prova. */
export function isTrialSend(events: EventLike[]): boolean {
  const sent = events.find((e) => e.kind === "sent");
  if (!sent) return false;
  return sent.meta?.dry_run === true || isTrialMessage(sent.message);
}

export const TRIAL_NOTE = "Creata su Fatture in Cloud in prova, non trasmessa allo SdI.";

/** Motivo dello scarto dall'ultimo evento "rejected" (se presente). */
export function rejectionReason(events: EventLike[]): string {
  const ev = events.find((e) => e.kind === "rejected");
  if (!ev?.message) return "";
  return ev.message.replace(/^Scartata dallo SdI:\s*/i, "").trim();
}

export interface Badge { label: string; color: string; title: string }

/** Badge di stato leggibile: In prova / Inviata / Consegnata / Scartata (gli altri stati restano quelli base). */
export function sdiBadge(stato: string, trial: boolean, base: { label: string; color: string }): Badge {
  if (stato === "inviata_intermediario") {
    return trial
      ? { label: "In prova", color: "var(--dim)", title: TRIAL_NOTE }
      : { label: "Inviata", color: base.color, title: "Trasmessa allo SdI: in attesa dell'esito. Apri il documento e usa “Aggiorna esito”." };
  }
  if (stato === "consegnata") return { ...base, title: "Consegnata dallo SdI al destinatario." };
  if (stato === "scartata") return { ...base, title: "Scartata dallo SdI: apri il documento per vedere il motivo." };
  if (stato === "emessa") return { ...base, title: "Emessa, non ancora inviata allo SdI." };
  return { ...base, title: base.label };
}

/** Esito di un aggiornamento che non cambia stato (nessun nuovo evento in timeline). */
export function unchangedStatusMessage(trial: boolean, providerMessage: string): string {
  if (trial) return `${TRIAL_NOTE} Nessun esito da aggiornare: per l'invio reale disattiva la prova e invia da Fatture in Cloud.`;
  return `Ancora in attesa dell'esito dello SdI. ${providerMessage}`.trim();
}
