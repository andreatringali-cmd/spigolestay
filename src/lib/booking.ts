// Calcolo UNICO del totale di una prenotazione, condiviso tra elenco, scheda e calendario,
// così il numero mostrato coincide ovunque.
//  Totale ospite = soggiorno (total) + pulizia (cleaningFee) + extra + tassa di soggiorno.
import { nights, shiftISO } from "./dates";
import { CHANNELS, type Channel, type Structure } from "./types";
import { loadChannelCommissionPct } from "./channelOverrides";
import { commissionEstimateFor, isNetPayout } from "./commission-estimate";
export { isNetPayout };

// Tassa di soggiorno. Due modalità:
//  - "fixed":   € a persona per notte × persone × notti tassabili
//  - "percent": % del pernottamento a persona per notte, con TETTO € a persona/notte
//               (es. Siracusa: (costo alloggio / numero ospiti) × 4%, max 5€ a persona/notte, prime 7 notti)
// `adults` = persone che PAGANO la tassa. `guests` = TUTTI gli ospiti, anche gli esenti (minori, ecc.): è il divisore del costo dell'alloggio, come nella formula del Comune.
// Senza `guests` si divide per i soli paganti (compatibilità). Importi arrotondati ai centesimi.
export function cityTaxOf(structure: Structure | undefined, adults: number, n: number, accommodation: number, exempt?: boolean, guests?: number): number {
  if (exempt || !structure?.cityTax) return 0;
  const persons = Math.max(1, adults || 0);
  const divisor = Math.max(persons, guests ?? 0);
  const nightsTot = Math.max(0, n || 0);
  const maxN = structure.cityTaxMaxNights ?? (structure.cityTaxMode === "percent" ? 7 : 3);
  const taxedNights = Math.min(nightsTot, maxN);
  if (taxedNights <= 0) return 0;
  if (structure.cityTaxMode === "percent") {
    const roomPerNight = nightsTot > 0 ? (accommodation || 0) / nightsTot : (accommodation || 0);
    const perPersonNight = (roomPerNight / divisor) * ((structure.cityTaxPercent ?? 0) / 100);
    const cap = structure.cityTaxCap ?? 0;
    const capped = cap > 0 ? Math.min(perPersonNight, cap) : perPersonNight;
    return Math.round(capped * persons * taxedNights * 100) / 100;
  }
  const rate = structure.cityTaxAmount ?? 2;
  return Math.round(persons * taxedNights * rate * 100) / 100;
}

type BookingLike = {
  checkIn: string; checkOut: string; adults?: number; children?: number; childAges?: number[];
  total?: number; cleaningFee?: number; extras?: { price?: number }[]; cityTaxExempt?: boolean;
};

// Persone paganti la tassa: adulti + minori NON esenti (età >= soglia comunale).
// Se non sono note le età dei bambini, si considerano esenti (comportamento prudente).
/** Imposta di soggiorno di una prenotazione: paganti = adulti + minori sopra la soglia, divisore = tutti gli ospiti. Un solo punto di calcolo per elenco, fatture, fascicolo, adempimenti e check-in. */
export function cityTaxOfBooking(structure: Structure | undefined, b: { adults?: number; children?: number; childAges?: number[]; checkIn: string; checkOut: string; total?: number; cityTaxExempt?: boolean }): number {
  const n = Math.max(0, Math.round((Date.parse(b.checkOut + "T00:00:00Z") - Date.parse(b.checkIn + "T00:00:00Z")) / 86400000));
  return cityTaxOf(structure, cityTaxPayers(structure, b), n, b.total ?? 0, b.cityTaxExempt, (b.adults ?? 0) + (b.children ?? 0));
}
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

// Come bookingGrandTotal ma SENZA la tassa di soggiorno: è quanto l'ospite ha pagato per il
// soggiorno in sé (soggiorno + pulizia + extra) — la cifra che si confronta con l'importo
// mostrato dall'OTA (Booking.com ecc. non fanno transitare la tassa di soggiorno, riscossa
// localmente). Usata nell'elenco Prenotazioni, dove "Totale" deve tornare con l'OTA.
export function bookingPaidTotal(b: BookingLike): number {
  const acc = b.total ?? 0;
  if (!acc) return 0;
  return acc + (b.cleaningFee ?? 0) + bookingExtrasTotal(b);
}

// Calcolo UNICO della commissione OTA, condiviso ovunque venga mostrata o sommata.
// Se è nota la cifra esatta (commissionAmount, es. da Booking.com/Channex) ha sempre priorità
// sul calcolo via percentuale, che resta una stima quando la cifra esatta non c'è.
type CommissionBookingLike = { total?: number; cleaningFee?: number; extras?: { price?: number }[]; channel: Channel; commissionPct?: number; commissionAmount?: number | null; paymentFee?: number | null; structureId?: string; netTotal?: boolean; extId?: string };
/**
 * Percentuale da usare quando una prenotazione NON ha la cifra reale: 1) quella impostata a mano in Canali, 2) la stima dai dati reali (media pesata
 * delle commissioni vere dello stesso canale e struttura nell'ultimo anno, vedi commission-estimate.ts), 3) la percentuale standard del canale.
 */
export function defaultCommissionInfo(channel: Channel, structureId?: string): { pct: number; source: "manuale" | "stima" | "standard" } {
  const manual = loadChannelCommissionPct(channel, structureId);
  if (manual !== undefined) return { pct: manual, source: "manuale" };
  const est = commissionEstimateFor(channel, structureId);
  if (est !== undefined) return { pct: est, source: "stima" };
  return { pct: CHANNELS[channel].commission * 100, source: "standard" };
}
export function commissionPctOf(b: CommissionBookingLike): number {
  if (isNetPayout(b)) return 0;
  if (b.commissionAmount != null && b.total) return Math.round(((b.commissionAmount + paymentFeeOf(b)) / b.total) * 1000) / 10;
  return b.commissionPct ?? defaultCommissionInfo(b.channel, b.structureId).pct;
}
/** Solo la commissione di intermediazione dell'OTA (senza il costo d'incasso). */
export function commissionBaseOf(b: CommissionBookingLike): number {
  if (isNetPayout(b)) return 0; // il totale è già netto: la commissione non si sottrae due volte
  if (b.commissionAmount != null) return b.commissionAmount;
  const pct = b.commissionPct ?? defaultCommissionInfo(b.channel, b.structureId).pct;
  return Math.round((b.total ?? 0) * pct) / 100; // ai centesimi, non all'euro intero
}
/** Commissioni totali trattenute dall'OTA: intermediazione + costo d'incasso (es. "Payment charge" di Booking.com). È la cifra della colonna Commissioni. */
export function commissionOf(b: CommissionBookingLike): number {
  return Math.round((commissionBaseOf(b) + paymentFeeOf(b)) * 100) / 100;
}
/** Costo d'incasso trattenuto dall'OTA (es. "Payment charge" di Booking.com), separato dalla commissione. */
export function paymentFeeOf(b: CommissionBookingLike): number {
  return b.paymentFee && b.paymentFee > 0 ? b.paymentFee : 0;
}
/** Lordo = quanto ha pagato l'ospite per il soggiorno (soggiorno + pulizia + extra, senza tassa di soggiorno): la cifra della colonna Totale. */
export function lordoOf(b: CommissionBookingLike): number {
  const acc = b.total ?? 0;
  if (!acc) return 0;
  return acc + (b.cleaningFee ?? 0) + (Array.isArray(b.extras) ? b.extras.reduce((a, e) => a + (e?.price || 0), 0) : 0);
}
/** Netto = lordo − commissioni (stessi numeri che si vedono nell'elenco). */
export function nettoOf(b: CommissionBookingLike): number {
  const lordo = lordoOf(b);
  return lordo ? Math.round((lordo - commissionOf(b)) * 100) / 100 : 0;
}
/** Percentuale di commissione REALE, calcolata dai numeri della riga: commissioni ÷ lordo × 100 (un decimale). Non è un valore impostato: è il risultato della formula. */
export function commissionShareOf(b: CommissionBookingLike): number {
  const lordo = lordoOf(b);
  return lordo > 0 ? Math.round((commissionOf(b) / lordo) * 1000) / 10 : 0;
}

type NightlyBookingLike = { total?: number; checkIn: string; checkOut: string; nightlyRates?: Record<string, number> };

// Ricavo REALE di una prenotazione nell'intervallo [from, to): usa il dettaglio notte-per-notte
// mandato dall'OTA (nightlyRates, es. Booking.com lo manda sempre) sommando solo le notti dentro
// l'intervallo, invece di stimarlo dividendo il totale in parti uguali sulle notti (impreciso se
// il prezzo cambia tra feriali/weekend). Le prenotazioni senza quel dettaglio (dirette, manuali,
// altre OTA) restano sulla stima proporzionale, l'unica cosa possibile per loro.
export function revenueInRange(b: NightlyBookingLike, from: string, to: string): number {
  const s = b.checkIn > from ? b.checkIn : from;
  const e = b.checkOut < to ? b.checkOut : to;
  if (e <= s) return 0;
  if (b.nightlyRates) {
    let sum = 0;
    for (let d = s; d < e; d = shiftISO(d, 1)) sum += b.nightlyRates[d] ?? 0;
    return sum;
  }
  const totalNights = Math.max(1, nights(b.checkIn, b.checkOut));
  let spanNights = 0;
  for (let d = s; d < e; d = shiftISO(d, 1)) spanNights++;
  return (b.total ?? 0) * (spanNights / totalNights);
}

// Come revenueInRange ma per UN singolo giorno (comodo per i grafici "per notte"/ADR).
export function nightlyRevenue(b: NightlyBookingLike, iso: string): number {
  return revenueInRange(b, iso, shiftISO(iso, 1));
}
