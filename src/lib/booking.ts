// Calcolo UNICO del totale di una prenotazione, condiviso tra elenco, scheda e calendario,
// così il numero mostrato coincide ovunque.
//  Totale ospite = soggiorno (total) + pulizia (cleaningFee) + extra + tassa di soggiorno.
import { nights } from "./dates";
import type { Structure } from "./types";

// Tassa di soggiorno. Due modalità:
//  - "fixed":   € a persona per notte × persone × notti tassabili
//  - "percent": % del pernottamento a persona per notte, con TETTO € a persona/notte
//               (es. Siracusa: 4% del costo camera/ospite, max 5€ a persona/notte, prime 7 notti)
export function cityTaxOf(structure: Structure | undefined, adults: number, n: number, accommodation: number, exempt?: boolean): number {
  if (exempt || !structure?.cityTax) return 0;
  const persons = Math.max(1, adults || 0);
  const nightsTot = Math.max(0, n || 0);
  const maxN = structure.cityTaxMaxNights ?? (structure.cityTaxMode === "percent" ? 7 : 3);
  const taxedNights = Math.min(nightsTot, maxN);
  if (taxedNights <= 0) return 0;
  if (structure.cityTaxMode === "percent") {
    const roomPerNight = nightsTot > 0 ? (accommodation || 0) / nightsTot : (accommodation || 0);
    const perPersonNight = (roomPerNight / persons) * ((structure.cityTaxPercent ?? 0) / 100);
    const cap = structure.cityTaxCap ?? 0;
    const capped = cap > 0 ? Math.min(perPersonNight, cap) : perPersonNight;
    return Math.round(capped * persons * taxedNights);
  }
  const rate = structure.cityTaxAmount ?? 2;
  return Math.round(persons * taxedNights * rate);
}

type BookingLike = {
  checkIn: string; checkOut: string; adults?: number; children?: number; childAges?: number[];
  total?: number; cleaningFee?: number; extras?: { price?: number }[]; cityTaxExempt?: boolean;
};

// Persone paganti la tassa: adulti + minori NON esenti (età >= soglia comunale).
// Se non sono note le età dei bambini, si considerano esenti (comportamento prudente).
export function cityTaxPayers(structure: Structure | undefined, b: { adults?: number; childAges?: number[] }): number {
  const adults = b.adults ?? 0;
  const freeUnder = structure?.cityTaxChildFreeUnder ?? 18; // default: tutti i minorenni esenti
  const payingKids = (b.childAges ?? []).filter((a) => typeof a === "number" && a >= freeUnder).length;
  return adults + payingKids;
}

export function bookingExtrasTotal(b: BookingLike): number {
  return Array.isArray(b.extras) ? b.extras.reduce((a, e) => a + (e?.price || 0), 0) : 0;
}

// Totale "quanto paga l'ospite". Se non c'è un prezzo soggiorno (total), ritorna 0.
export function bookingGrandTotal(b: BookingLike, structure: Structure | undefined): number {
  const acc = b.total ?? 0;
  if (!acc) return 0;
  const clean = b.cleaningFee ?? 0;
  const tax = cityTaxOf(structure, cityTaxPayers(structure, b), nights(b.checkIn, b.checkOut), acc, b.cityTaxExempt);
  return acc + clean + bookingExtrasTotal(b) + tax;
}
