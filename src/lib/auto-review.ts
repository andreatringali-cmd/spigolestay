// Richiesta di recensione dopo il check-out: regole di invio e scelta dei link ai portali. Funzioni pure, nessuna rete, nessun import
// (le usano sia il cron dei messaggi automatici sia la pagina Modelli & automazioni, e i test).
//
// Regole (rispettano le condizioni dei portali):
//  - nessun incentivo/sconto in cambio della recensione: i testi invitano a una recensione sincera, e basta;
//  - niente richiesta se la prenotazione è annullata / no-show / provvisoria / blocco, o se la richiesta è già stata inviata a mano;
//  - niente richiesta agli ospiti "Da recuperare" (tag CRM) e, se attivata l'opzione, a chi risulta aver segnalato un problema nelle note;
//  - Booking.com invia già il suo invito: non si mette MAI un link Booking nel messaggio (e, a scelta, si salta chi arriva da Booking);
//  - senza almeno un link (Google o Tripadvisor) non si invia nulla: una richiesta senza link non serve a niente.

/** Chiave localStorage (sincronizzata nel blob dell'account, quindi leggibile dal cron). */
export const REVIEW_SETTINGS_KEY = "spigolestay:reviewsettings";

export interface ReviewStructureSettings {
  googleUrl?: string;      // link recensioni Google scelto a mano (altrimenti si ricava da Place ID / guida)
  tripadvisorUrl?: string; // link "scrivi una recensione" di Tripadvisor (facoltativo)
}
export interface ReviewSettings {
  /** Ospiti con uno di questi tag CRM non ricevono la richiesta. Default: "Da recuperare". */
  skipTags: string[];
  /** Se acceso: non inviare a chi ha nelle note (prenotazione/ospite/richieste) parole che indicano un reclamo. DEFAULT SPENTO. */
  skipIfIssueNotes: boolean;
  /** Se acceso: non inviare agli ospiti arrivati da Booking.com (che manda già il suo invito). DEFAULT SPENTO. */
  skipBookingChannel: boolean;
  structures: Record<string, ReviewStructureSettings>;
}
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { skipTags: ["Da recuperare"], skipIfIssueNotes: false, skipBookingChannel: false, structures: {} };

/** Link accettato solo se è un indirizzo http(s) senza spazi: niente testo libero né schemi strani nei messaggi agli ospiti. */
export function cleanUrl(u: unknown): string {
  const v = typeof u === "string" ? u.trim() : "";
  return /^https?:\/\/[^\s]+$/i.test(v) ? v : "";
}

/** Legge le impostazioni (JSON salvato o già oggetto) con valori di riserva per tutto ciò che manca o è malformato. */
export function parseReviewSettings(raw: unknown): ReviewSettings {
  let o: unknown = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch { o = null; } }
  const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const tags = Array.isArray(r.skipTags) ? r.skipTags.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : DEFAULT_REVIEW_SETTINGS.skipTags;
  const structures: Record<string, ReviewStructureSettings> = {};
  if (r.structures && typeof r.structures === "object") {
    for (const [id, v] of Object.entries(r.structures as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const g = cleanUrl((v as Record<string, unknown>).googleUrl), t = cleanUrl((v as Record<string, unknown>).tripadvisorUrl);
      if (g || t) structures[id] = { ...(g ? { googleUrl: g } : {}), ...(t ? { tripadvisorUrl: t } : {}) };
    }
  }
  return { skipTags: tags, skipIfIssueNotes: r.skipIfIssueNotes === true, skipBookingChannel: r.skipBookingChannel === true, structures };
}

/** Link diretto "scrivi una recensione" di Google dal Place ID (stesso formato di lib/reviews.ts). */
export function googleWriteReviewUrl(placeId?: string | null): string {
  const id = (placeId ?? "").trim();
  return id ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}` : "";
}

export interface ReviewLinks { google: string; tripadvisor: string }

/**
 * Link ai portali per una struttura. Google, in ordine: link scelto nelle impostazioni → link diretto dal Place ID → link recensioni della guida ospiti.
 * Booking non compare mai (non ha un link pubblico e manda già il suo invito); Tripadvisor solo se l'host ha inserito l'indirizzo.
 */
export function reviewLinksFor(o: { structureId: string; placeId?: string | null; guideReviewUrl?: string | null; settings: ReviewSettings }): ReviewLinks {
  const own = o.settings.structures[o.structureId] ?? {};
  const google = cleanUrl(own.googleUrl) || googleWriteReviewUrl(o.placeId) || cleanUrl(o.guideReviewUrl);
  return { google, tripadvisor: cleanUrl(own.tripadvisorUrl) };
}

/** Elenco dei link per il messaggio (uno per riga: "Google: https://…"). Vuoto se non c'è nessun link. */
export function reviewLinksBlock(l: ReviewLinks): string {
  return [l.google && `Google: ${l.google}`, l.tripadvisor && `Tripadvisor: ${l.tripadvisor}`].filter(Boolean).join("\n");
}
/** Segnaposto sostituiti dal cron per la richiesta di recensione. */
export function reviewTokens(l: ReviewLinks): Record<string, string> {
  return { link_recensioni: reviewLinksBlock(l), link_google: l.google, link_tripadvisor: l.tripadvisor };
}
/** Il testo contiene un segnaposto dei link di recensione? (allora serve almeno un link per poter inviare) */
export const usesReviewLinks = (text: string) => /\{link_(recensioni|google|tripadvisor)\}/i.test(text);

/** Parole che nelle note indicano un reclamo/problema (usate solo se skipIfIssueNotes è acceso). */
const ISSUE_RE = /reclam|lamentel|lament|problem|disservizi|insoddisf|rimbors|sporc|rott[oa]\b|guast|complain|refund|dirty|broken|disappoint|unhappy|issue/i;

export type ReviewSkip = "not_confirmed" | "blocked" | "already_requested" | "booking_channel" | "guest_tag" | "issue_notes";
export interface ReviewBookingLite { status?: string; channel?: string; reviewRequestedAt?: number; note?: string; guestRequests?: string }
export interface ReviewGuestLite { tags?: string[]; notes?: string }

/** Si può chiedere la recensione per questa prenotazione? (la data di invio la decide il modello: qui solo le esclusioni) */
export function reviewDecision(b: ReviewBookingLite, g: ReviewGuestLite | undefined, s: ReviewSettings): { send: true } | { send: false; reason: ReviewSkip } {
  if (b.channel === "blocked") return { send: false, reason: "blocked" };
  if (b.status !== "confirmed") return { send: false, reason: "not_confirmed" }; // annullata, no-show o provvisoria
  if (typeof b.reviewRequestedAt === "number" && b.reviewRequestedAt > 0) return { send: false, reason: "already_requested" };
  if (s.skipBookingChannel && b.channel === "booking") return { send: false, reason: "booking_channel" };
  const skip = new Set(s.skipTags.map((x) => x.toLowerCase()));
  if ((g?.tags ?? []).some((t) => skip.has(String(t).toLowerCase()))) return { send: false, reason: "guest_tag" };
  if (s.skipIfIssueNotes && ISSUE_RE.test([b.note, b.guestRequests, g?.notes].filter(Boolean).join(" \n "))) return { send: false, reason: "issue_notes" };
  return { send: true };
}

/** I valori dei modelli WhatsApp (Meta) non possono contenere a capo: le righe diventano un elenco su una riga. */
export const oneLine = (v: string) => v.replace(/\s*\n+\s*/g, " · ");
