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
    .map((g) => ({ g, n: count.get(g.id) ?? 0, starts: fold(guestParts(g).lastName).startsWith(tokens[0]) }))
    .sort((a, b) => Number(b.starts) - Number(a.starts) || b.n - a.n || (a.g.fullName ?? "").localeCompare(b.g.fullName ?? "", "it"))
    .slice(0, limit)
    .map(({ g, n }) => ({ g, n }));
}

// Particelle che stanno attaccate al cognome: «De Filippis Mario» → cognome «De Filippis», nome «Mario».
const PARTICLES = new Set(["de", "di", "da", "del", "della", "dello", "dei", "degli", "delle", "dal", "dalla", "dai", "la", "lo", "le", "li", "van", "von", "der", "den", "el", "al", "mc", "mac", "st", "san", "santa"]);
const cap = (w: string) => w.replace(/(^|[-'’])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
/** Tutto maiuscolo («TRIDA EMANUELA») o tutto minuscolo → «Trida Emanuela»; se c'è già un maiuscolo/minuscolo misto il testo non si tocca. */
const tidy = (s: string) => (s !== s.toUpperCase() && s !== s.toLowerCase() ? s : s.toLowerCase().split(" ").map(cap).join(" "));

/**
 * Il registro ha quasi sempre solo il nome intero scritto «Cognome Nome» (come arriva da Booking, Airbnb o dalla schedina): prima parola = cognome, il resto = nome;
 * le particelle (De, Di, Van…) restano attaccate al cognome. Una parola sola = cognome. Spazi doppi ignorati.
 */
export function splitFullName(full: string): { lastName: string; firstName: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lastName: "", firstName: "" };
  let n = 1;
  while (n < words.length && PARTICLES.has(words[n - 1].toLowerCase())) n++; // una particella si unisce alla parola che segue
  return { lastName: tidy(words.slice(0, n).join(" ")), firstName: tidy(words.slice(n).join(" ")) };
}

/** Cognome e nome di un ospite del registro: quelli salvati separati, altrimenti ricavati dal nome intero. */
export function guestParts(g: Guest): { lastName: string; firstName: string } {
  if ((g.lastName ?? "").trim() || (g.firstName ?? "").trim()) return { lastName: (g.lastName ?? "").trim(), firstName: (g.firstName ?? "").trim() };
  return splitFullName(g.fullName ?? "");
}
/** «Cognome Nome» da mostrare nell'elenco dei suggerimenti. */
export const guestDisplayName = (g: Guest): string => { const p = guestParts(g); return [p.lastName, p.firstName].filter(Boolean).join(" ") || (g.fullName ?? ""); };

/** I campi da compilare in un colpo solo scegliendo un ospite dal registro. */
export function guestFormFields(g: Guest): { lastName: string; firstName: string; email: string; phone: string } {
  const p = guestParts(g);
  return { lastName: p.lastName, firstName: p.firstName, email: g.email ?? "", phone: g.phone ?? "" };
}
