// Helper per la RICHIESTA di recensione post check-out + tracciamento invio.
// Nota d'onestà: le recensioni effettivamente ricevute su Google NON sono recuperabili
// senza API a pagamento (Places espone solo ~5 recensioni). Questo modulo si concentra
// sulla RICHIESTA all'ospite e sul tracciamento dell'invio, non sul recupero delle recensioni.
// Nessuna dipendenza da React: funzioni pure, riusabili lato client.

import type { Booking, Guest } from "./types";
import { parseISO, toISO, nights } from "./dates";

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

// Messaggio precompilato (WhatsApp/email) con il link diretto alla recensione Google.
// Se manca il link, il messaggio invita comunque a recensire ma senza URL (la UI blocca l'invio).
export function reviewRequestMessage(opts: {
  guestName?: string;
  structureName?: string;
  reviewUrl?: string | null;
}): string {
  const first = (opts.guestName || "").split(" ")[0] || "";
  const hi = first ? `Ciao ${first},` : "Ciao,";
  const st = opts.structureName || "la struttura";
  const link = opts.reviewUrl
    ? `\n\nBastano 30 secondi da qui:\n${opts.reviewUrl}`
    : "";
  return `${hi}
grazie di aver scelto ${st}! Speriamo che il tuo soggiorno sia stato speciale.
Se ti va, ci aiuteresti tantissimo lasciando una breve recensione su Google.${link}

Grazie di cuore e a presto! 🌊`;
}

// Numero di notti del soggiorno (per il riepilogo in scheda).
export function stayNights(b: Booking): number {
  try { return nights(b.checkIn, b.checkOut); } catch { return 0; }
}
