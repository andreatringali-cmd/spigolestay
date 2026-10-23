// Suggerimenti di ospiti già nel registro mentre si scrive il nome in una nuova prenotazione. Funzione pura (usata dal modulo veloce, dalla pagina completa e dai test).
import type { Booking, Guest } from "./types";

/** Minuscolo e senza accenti: «Rossi» trova «rossi», «Nicolo» trova «Nicolò». */
export const fold = (s: string): string => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export interface GuestSuggestion { g: Guest; n: number }

/**
 * Già dalla PRIMA lettera, sulle INIZIALI delle parole del cognome e del nome («ro» → Rossi Mario, Roberto Bianchi). Ogni parola scritta deve essere l'inizio di una parola
 * dell'ospite. Prima chi ha il cognome che comincia come scritto, poi chi ha più soggiorni (non annullati), poi ordine alfabetico. Niente testo = nessun suggerimento.
 */
export function suggestGuests(guests: readonly Guest[], bookings: readonly Pick<Booking, "guestId" | "status">[], lastName: string, firstName: string, limit = 8): GuestSuggestion[] {
  const tokens = fold(`${lastName} ${firstName}`).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const count = new Map<string, number>();
  for (const b of bookings) if (b.guestId && b.status !== "cancelled") count.set(b.guestId, (count.get(b.guestId) ?? 0) + 1);
  return guests
    .filter((g) => { const words = fold(`${g.lastName ?? ""} ${g.firstName ?? ""} ${g.fullName ?? ""}`).split(/\s+/).filter(Boolean); return tokens.every((tk) => words.some((w) => w.startsWith(tk))); })
    .map((g) => ({ g, n: count.get(g.id) ?? 0, starts: fold(g.lastName ?? g.fullName ?? "").startsWith(tokens[0]) }))
    .sort((a, b) => Number(b.starts) - Number(a.starts) || b.n - a.n || (a.g.fullName ?? "").localeCompare(b.g.fullName ?? "", "it"))
    .slice(0, limit)
    .map(({ g, n }) => ({ g, n }));
}

/** I campi da compilare in un colpo solo scegliendo un ospite dal registro. */
export function guestFormFields(g: Guest): { lastName: string; firstName: string; email: string; phone: string } {
  return { lastName: g.lastName ?? g.fullName ?? "", firstName: g.firstName ?? "", email: g.email ?? "", phone: g.phone ?? "" };
}
