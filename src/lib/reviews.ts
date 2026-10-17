// Helper per la RICHIESTA di recensione post check-out + tracciamento invio.
// Nota d'onestà: le recensioni effettivamente ricevute su Google NON sono recuperabili
// senza API a pagamento (Places espone solo ~5 recensioni). Questo modulo si concentra
// sulla RICHIESTA all'ospite e sul tracciamento dell'invio, non sul recupero delle recensioni.
// Nessuna dipendenza da React: funzioni pure, riusabili lato client.

import type { Booking, Guest } from "./types";
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

const REVIEW_T: Record<ReviewLang, { hi: (n: string) => string; thanks: (s: string) => string; ask: string; asHere: string; end: string; stFallback: string }> = {
  it: { hi: (n) => (n ? `Ciao ${n},` : "Ciao,"), thanks: (s) => `grazie di aver scelto ${s}! Speriamo che il tuo soggiorno sia stato speciale.`, ask: "Se ti va, ci aiuteresti tantissimo lasciando una breve recensione sincera.", asHere: "Bastano 30 secondi da qui:", end: "Grazie di cuore e a presto! 🌊", stFallback: "la struttura" },
  en: { hi: (n) => (n ? `Hi ${n},` : "Hi,"), thanks: (s) => `thank you for choosing ${s}! We hope your stay was special.`, ask: "If you like, a short, honest review would help us a lot.", asHere: "It only takes 30 seconds:", end: "Thank you so much, and see you soon! 🌊", stFallback: "us" },
  fr: { hi: (n) => (n ? `Bonjour ${n},` : "Bonjour,"), thanks: (s) => `merci d'avoir choisi ${s} ! Nous espérons que votre séjour a été exceptionnel.`, ask: "Si vous le souhaitez, un court avis sincère nous aiderait énormément.", asHere: "Cela ne prend que 30 secondes :", end: "Merci de tout cœur et à bientôt ! 🌊", stFallback: "notre établissement" },
  de: { hi: (n) => (n ? `Hallo ${n},` : "Hallo,"), thanks: (s) => `vielen Dank, dass Sie sich für ${s} entschieden haben! Wir hoffen, Ihr Aufenthalt war etwas Besonderes.`, ask: "Wenn Sie möchten, würde uns eine kurze, ehrliche Bewertung sehr helfen.", asHere: "Es dauert nur 30 Sekunden:", end: "Herzlichen Dank und bis bald! 🌊", stFallback: "uns" },
  es: { hi: (n) => (n ? `Hola ${n},` : "Hola,"), thanks: (s) => `¡gracias por elegir ${s}! Esperamos que tu estancia haya sido especial.`, ask: "Si te apetece, una breve reseña sincera nos ayudaría muchísimo.", asHere: "Solo tardas 30 segundos:", end: "¡Muchas gracias y hasta pronto! 🌊", stFallback: "nuestro alojamiento" },
};
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
  const T = REVIEW_T[opts.lang ?? "it"];
  const first = (opts.guestName || "").split(" ")[0] || "";
  const st = (opts.structureName || "").trim() || T.stFallback;
  const links = (opts.linksBlock || "").trim() || (opts.reviewUrl ? opts.reviewUrl : "");
  const link = links ? `\n\n${T.asHere}\n${links}` : "";
  return `${T.hi(first)}
${T.thanks(st)}
${T.ask}${link}

${T.end}`;
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
