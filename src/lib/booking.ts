// Calcolo UNICO del totale di una prenotazione, condiviso tra elenco, scheda e calendario,
// così il numero mostrato coincide ovunque.
//  Totale ospite = soggiorno (total) + pulizia (cleaningFee) + extra + tassa di soggiorno.
import { nights } from "./dates";
import type { Structure } from "./types";

export function cityTaxOf(structure: Structure | undefined, adults: number, n: number, accommodation: number, exempt?: boolean): number {
  if (exempt || !structure?.cityTax) return 0;
  if (structure.cityTaxMode === "percent") return Math.round((accommodation || 0) * (structure.cityTaxPercent ?? 0) / 100);
  const rate = structure.cityTaxAmount ?? 2;
  const maxN = structure.cityTaxMaxNights ?? 3;
  return Math.round(adults * Math.min(n, maxN) * rate);
}

type BookingLike = {
  checkIn: string; checkOut: string; adults?: number;
  total?: number; cleaningFee?: number; extras?: { price?: number }[]; cityTaxExempt?: boolean;
};

export function bookingExtrasTotal(b: BookingLike): number {
  return Array.isArray(b.extras) ? b.extras.reduce((a, e) => a + (e?.price || 0), 0) : 0;
}

// Totale "quanto paga l'ospite". Se non c'è un prezzo soggiorno (total), ritorna 0.
export function bookingGrandTotal(b: BookingLike, structure: Structure | undefined): number {
  const acc = b.total ?? 0;
  if (!acc) return 0;
  const clean = b.cleaningFee ?? 0;
  const tax = cityTaxOf(structure, b.adults ?? 0, nights(b.checkIn, b.checkOut), acc, b.cityTaxExempt);
  return acc + clean + bookingExtrasTotal(b) + tax;
}
