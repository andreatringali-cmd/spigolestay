// Helper per la RICHIESTA di recensione post check-out + tracciamento invio.
// Nota d'onestà: le recensioni effettivamente ricevute su Google NON sono recuperabili
// senza API a pagamento (Places espone solo ~5 recensioni). Questo modulo si concentra
// sulla RICHIESTA all'ospite e sul tracciamento dell'invio, non sul recupero delle recensioni.
// Nessuna dipendenza da React: funzioni pure, riusabili lato client.

import type { Booking, Guest } from "./types";
import { renderSystemMessage } from "./msg-overrides";
import { parseISO, toISO, nights } from "./dates";
import { REVIEW_SETTINGS_KEY, parseReviewSettings, reviewLinksFor, reviewLinksBlock } from "./auto-review";

// Link diretto alla scrittura di una recensione Google della struttura (dal Place ID).
// Restituisce null se il Place ID manca → la UI mostra l'avviso "imposta Google Place ID".
export function googleReviewUrl(placeId?: string | null): string | null {
  const id = (placeId || "").trim();
  return id ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}` : null;
}

// Nome di battesimo dell'ospite (per il saluto del messaggio).
export function guestFirstName(g?: Guest | null): string {
  if (!g) return "";
  return (g.firstName || g.fullName?.split(" ")[0] || "").trim();
}

export interface CheckoutItem {
  booking: Booking;
  guest?: Guest;
  guestName: string; // nome mostrato (fallback "Ospite")
  daysAgo: number;   // giorni trascorsi dal check-out (0 = oggi)
  requested: boolean; // richiesta di recensione già inviata?
}

// Prenotazioni con check-out passato negli ultimi N giorni, dalle quali chiedere la recensione.
// Esclude annullate / no-show / blocchi. Ordina dal check-out più recente.
export function recentCheckouts(
  bookings: Booking[],
  guests: Guest[],
  opts: { days: number; structureId?: string; today?: Date },
): CheckoutItem[] {
  const days = Math.max(1, opts.days || 30);
  const today = opts.today ?? new Date();
  const todayISO = toISO(today);
  const todayTime = parseISO(todayISO).getTime();
  const guestById = new Map(guests.map((g) => [g.id, g]));
  return bookings
    .filter((b) => {
      if (opts.structureId && opts.structureId !== "all" && b.structureId !== opts.structureId) return false;
      if (b.channel === "blocked") return false;
      if (b.status === "cancelled" || b.status === "no_show") return false;
      if (!b.checkOut) return false;
      const coTime = parseISO(b.checkOut).getTime();
      if (isNaN(coTime)) return false;
      // check-out già passato (strettamente < oggi) e non più vecchio di N giorni
      const daysAgo = Math.round((todayTime - coTime) / 86_400_000);
      return daysAgo >= 1 && daysAgo <= days;
    })
    .map((b) => {
      const g = guestById.get(b.guestId);
      const daysAgo = Math.round((todayTime - parseISO(b.checkOut).getTime()) / 86_400_000);
      return {
        booking: b,
        guest: g,
        guestName: g?.fullName?.trim() || guestFirstName(g) || "Ospite",
        daysAgo,
        requested: typeof b.reviewRequestedAt === "number",
      };
    })
    .sort((a, b) => (b.booking.checkOut || "").localeCompare(a.booking.checkOut || ""));
}

/** Lingue dei messaggi agli ospiti. */
export type ReviewLang = "it" | "en" | "fr" | "de" | "es";

const REVIEW_ST_FALLBACK: Record<ReviewLang, string> = { it: "la struttura", en: "us", fr: "notre établissement", de: "uns", es: "nuestro alojamiento" };
const SUBJECT_T: Record<ReviewLang, (s: string) => string> = {
  it: (s) => `Com'è andato il soggiorno${s ? ` da ${s}` : ""}?`,
  en: (s) => `How was your stay${s ? ` at ${s}` : ""}?`,
  fr: (s) => `Comment s'est passé votre séjour${s ? ` à ${s}` : ""} ?`,
  de: (s) => `Wie war Ihr Aufenthalt${s ? ` in ${s}` : ""}?`,
  es: (s) => `¿Qué tal tu estancia${s ? ` en ${s}` : ""}?`,
};
/** Oggetto dell'email di richiesta recensione, nella lingua dell'ospite. */
export const reviewRequestSubject = (lang: ReviewLang | undefined, structureName?: string) => SUBJECT_T[lang ?? "it"]((structureName ?? "").trim());

// Messaggio precompilato (WhatsApp/email) con il/i link alla recensione, nella lingua dell'ospite (default italiano).
// `linksBlock` = elenco dei link configurati in Modelli & automazioni (Google + Tripadvisor, una riga ciascuno: stesso blocco del messaggio automatico);
// se manca si usa `reviewUrl` (solo Google). Senza alcun link il messaggio invita comunque a recensire ma senza URL (la UI blocca l'invio).
export function reviewRequestMessage(opts: {
  guestName?: string;
  structureName?: string;
  reviewUrl?: string | null;
  lang?: ReviewLang;
  linksBlock?: string;
}): string {
  const lang = opts.lang ?? "it";
  const first = (opts.guestName || "").split(" ")[0] || "";
  const st = (opts.structureName || "").trim() || REVIEW_ST_FALLBACK[lang];
  const links = (opts.linksBlock || "").trim() || (opts.reviewUrl ? opts.reviewUrl : "");
  // Testo modificabile (Messaggi → Modelli): senza link la riga che li introduce sparisce insieme al segnaposto.
  return renderSystemMessage("review", lang, { nome: first, struttura: st, link_recensioni: links });
}

/**
 * Link alle recensioni di una struttura come li usa il messaggio automatico: link scelto in Modelli & automazioni (Google e Tripadvisor), poi Place ID, poi guida ospiti.
 * Legge le impostazioni dal browser (localStorage); senza storage o senza dati restituisce l'elenco vuoto.
 */
export function reviewLinksBlockFromStorage(structureId: string, placeId?: string | null): string {
  let guideReviewUrl = "";
  try { guideReviewUrl = JSON.parse(localStorage.getItem("spigolestay:guides") || "{}")?.[structureId]?.reviewUrl || ""; } catch { /* nessuna guida */ }
  let raw: string | null = null;
  try { raw = localStorage.getItem(REVIEW_SETTINGS_KEY); } catch { /* storage non disponibile */ }
  return reviewLinksBlock(reviewLinksFor({ structureId, placeId, guideReviewUrl, settings: parseReviewSettings(raw) }));
}

// Numero di notti del soggiorno (per il riepilogo in scheda).
export function stayNights(b: Booking): number {
  try { return nights(b.checkIn, b.checkOut); } catch { return 0; }
}
