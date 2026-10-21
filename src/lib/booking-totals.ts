// «Totale soggiorno» e «Totale con tassa»: la regola in UN solo posto.
// La stessa prenotazione mostrava 187 € in Prenotazioni/Cassa e 195 € in Pagamenti e nel voucher perché sono due totali diversi che si
// chiamavano entrambi «Totale»:
//   - totale SOGGIORNO  = camera + pulizia + extra, SENZA tassa di soggiorno (è la cifra che torna con l'OTA)  → bookingPaidTotal
//   - totale CON TASSA  = totale soggiorno + tassa di soggiorno (quanto paga l'ospite in tutto)               → bookingGrandTotal
// Nessun dato cambia: qui si definisce solo come si calcolano e come si chiamano nelle schermate.
import type { Structure } from "./types";
import { bookingGrandTotal, bookingPaidTotal, cityTaxOfBooking, type BookingLike } from "./booking";
import { roundCents } from "./money";

export interface BookingTotals { stay: number; tax: number; withTax: number }

/** Etichette uniche da usare nelle schermate. */
export const TOTAL_STAY_LABEL = "Totale soggiorno";
export const TOTAL_WITH_TAX_LABEL = "Totale con tassa";
export const TOTAL_STAY_HINT = "Camera + pulizia + extra, senza la tassa di soggiorno (che si riscuote a parte).";

/** I due totali (e la tassa) di una prenotazione. Senza prezzo del soggiorno è tutto 0, come nel resto dell'app. */
export function bookingTotals(b: BookingLike, structure: Structure | undefined): BookingTotals {
  const stay = bookingPaidTotal(b);
  if (!stay) return { stay: 0, tax: 0, withTax: 0 };
  return { stay: roundCents(stay), tax: roundCents(cityTaxOfBooking(structure, b)), withTax: roundCents(bookingGrandTotal(b, structure)) };
}

/** Per le viste che hanno già le cifre (voucher, email): soggiorno e tassa → i tre importi coerenti. */
export function totalsFromAmounts(stay: number, tax: number): BookingTotals {
  const s = roundCents(stay), t = roundCents(Math.max(0, tax));
  return { stay: s, tax: t, withTax: roundCents(s + t) };
}

/** «Soggiorno 187,00 € · Tassa 8,00 € · Totale 195,00 €» (senza la tassa: «Soggiorno 187,00 €»). */
export function totalsBreakdown(t: BookingTotals, money: (n: number) => string): string {
  if (t.tax <= 0) return `Soggiorno ${money(t.stay)}`;
  return `Soggiorno ${money(t.stay)} · Tassa ${money(t.tax)} · Totale ${money(t.withTax)}`;
}
