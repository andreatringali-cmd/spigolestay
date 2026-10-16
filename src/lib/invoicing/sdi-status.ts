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

// ───────────────────────── Aggiornamento automatico degli esiti (cron) ─────────────────────────

/** Massimo di documenti controllati per tenant a ogni esecuzione del cron. */
export const SDI_POLL_LIMIT = 50;
/** Oltre questi giorni dall'invio un documento ancora "in attesa" non viene più interrogato. */
export const SDI_POLL_MAX_AGE_DAYS = 60;

export interface PollCandidate { id: string; stato: string; provider: string | null; provider_ref: string | null; sent_at: string | null }

/** Il riferimento è di Fatture in Cloud ("fic:...")? */
export function isFicRef(ref: string | null | undefined): boolean {
  return typeof ref === "string" && ref.startsWith("fic:") && ref.length > 4;
}

export interface PollSelection { selected: PollCandidate[]; skippedTrial: number; skippedOld: number; skippedOther: number; skippedOverLimit: number }

/**
 * Quali documenti interrogare presso lo SdI (tramite il provider):
 * - solo stato "inviata_intermediario", provider fattureincloud, provider_ref "fic:...";
 * - NON quelli creati in prova (ultimo evento "sent" con dry_run o messaggio di prova);
 * - solo inviati da meno di `maxAgeDays` giorni (data sent_at; se manca, il documento non è valutabile e si salta);
 * - dal più recente al più vecchio (l'esito arriva di solito in pochi giorni: i documenti fermi da settimane non devono occupare il limite), al massimo `limit`.
 * `eventsByDoc`: eventi di ogni documento ordinati dal più recente (come in isTrialSend).
 */
export function selectDocsToPoll(
  candidates: PollCandidate[],
  eventsByDoc: Record<string, EventLike[] | undefined>,
  nowMs: number,
  opts: { limit?: number; maxAgeDays?: number } = {},
): PollSelection {
  const limit = opts.limit ?? SDI_POLL_LIMIT;
  const maxAgeMs = (opts.maxAgeDays ?? SDI_POLL_MAX_AGE_DAYS) * 86_400_000;
  const out: PollSelection = { selected: [], skippedTrial: 0, skippedOld: 0, skippedOther: 0, skippedOverLimit: 0 };
  const eligible: { c: PollCandidate; t: number }[] = [];
  for (const c of candidates) {
    if (c.stato !== "inviata_intermediario" || c.provider !== "fattureincloud" || !isFicRef(c.provider_ref)) { out.skippedOther++; continue; }
    if (isTrialSend(eventsByDoc[c.id] ?? [])) { out.skippedTrial++; continue; }
    const t = c.sent_at ? Date.parse(c.sent_at) : NaN;
    if (!Number.isFinite(t)) { out.skippedOther++; continue; }
    if (nowMs - t > maxAgeMs) { out.skippedOld++; continue; }
    eligible.push({ c, t });
  }
  eligible.sort((a, b) => b.t - a.t);
  out.selected = eligible.slice(0, limit).map((x) => x.c);
  out.skippedOverLimit = Math.max(0, eligible.length - limit);
  return out;
}

export interface PollTally { checked: number; changed: number; rejected: number; delivered: number; errors: number; notified: number }
export const emptyTally = (): PollTally => ({ checked: 0, changed: 0, rejected: 0, delivered: 0, errors: 0, notified: 0 });

/** Somma i conteggi di più tenant. */
export function addTally(a: PollTally, b: PollTally): PollTally {
  return { checked: a.checked + b.checked, changed: a.changed + b.changed, rejected: a.rejected + b.rejected, delivered: a.delivered + b.delivered, errors: a.errors + b.errors, notified: a.notified + b.notified };
}

/** Registra l'esito di UN documento controllato (outcome = null → errore). */
export function tallyOutcome(t: PollTally, outcome: { stato: string; changed: boolean } | null): PollTally {
  if (!outcome) return { ...t, checked: t.checked + 1, errors: t.errors + 1 };
  return {
    ...t,
    checked: t.checked + 1,
    changed: t.changed + (outcome.changed ? 1 : 0),
    rejected: t.rejected + (outcome.changed && outcome.stato === "scartata" ? 1 : 0),
    delivered: t.delivered + (outcome.changed && outcome.stato === "consegnata" ? 1 : 0),
  };
}

/** Evento marcatore: l'avviso di scarto è già stato gestito per questo documento. */
export const REJECTED_NOTIFIED_KIND = "rejected_notified";

/** Va inviato l'avviso di scarto? Sì se il documento è scartato e non esiste già un marcatore "rejected_notified". */
export function shouldNotifyRejection(events: EventLike[]): boolean {
  return events.some((e) => e.kind === "rejected") && !events.some((e) => e.kind === REJECTED_NOTIFIED_KIND);
}

const itDate = (iso: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso ?? "");
};

/** Oggetto e testo (semplice, italiano) dell'email al titolare per una fattura scartata. */
export function rejectionEmail(d: { numberLabel?: string | null; issueDate?: string | null; customer?: string | null; reason?: string | null }): { subject: string; text: string } {
  const num = d.numberLabel?.trim() || "(senza numero)";
  const date = d.issueDate ? ` del ${itDate(d.issueDate)}` : "";
  const cust = d.customer?.trim() ? ` a ${d.customer.trim()}` : "";
  const reason = d.reason?.trim() || "motivo non indicato dall'intermediario";
  return {
    subject: `Fattura ${num} scartata dallo SdI`,
    text: `La fattura n. ${num}${date}${cust} è stata scartata dallo SdI: ${reason}.\n\nAprila in Xenora per correggere ed emettere una nota di credito / nuovo documento.`,
  };
}

/** Messaggio di un evento in forma breve per la scheda documento: il lungo "Documento creato… (MODALITÀ PROVA…)" si accorcia e
 *  la parte "Attenzione: Fatture in Cloud calcola un totale di € X invece di € Y (Xenora)…" diventa un avviso a parte. */
export function eventDisplay(message: string): { text: string; warn?: string } {
  const m = (message ?? "").trim();
  const att = /\s*Attenzione:\s*Fatture in Cloud calcola un totale di (€\s?[\d.,]+) invece di (€\s?[\d.,]+) \(Xenora\)[^.]*\.?/i.exec(m);
  let text = att ? m.replace(att[0], "").trim() : m;
  const warn = att ? `Totale diverso su Fatture in Cloud: ${att[1]} invece di ${att[2]} (Xenora). Controlla bollo e voci.` : undefined;
  if (/MODALIT[ÀA] PROVA/i.test(text) && /Documento creato in Fatture in Cloud/i.test(text)) text = "Creato su Fatture in Cloud in prova, non inviato allo SdI.";
  return { text, warn };
}
