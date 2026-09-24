// Calcolo tassa/imposta di soggiorno — logica UNICA condivisa fra la pagina
// "Tassa di soggiorno" e l'azione "Elabora tutto" degli Adempimenti (niente duplicati).
// Regole di default = preset Comune di Siracusa.
import { nights } from "@/lib/dates";
import type { Booking } from "@/lib/types";

export interface CityTaxRules {
  taxMode: "percentuale" | "fisso";
  amount: number;   // € per persona/notte (modalità fisso)
  pct: number;      // % del pernottamento (modalità percentuale)
  cap: number;      // tetto massimo € per persona/notte
  maxNights: number;
  childrenExempt: boolean; // minori esenti quando non è nota l'età
  exemptAge: number;       // esenti sotto questa età (Siracusa: under 14)
}

// Preset Comune di Siracusa: 4% del pernottamento, tetto 5 €/persona/notte, max 7 notti, under 14 esenti.
export const DEFAULT_CITY_TAX_RULES: CityTaxRules = {
  taxMode: "percentuale", amount: 2, pct: 4, cap: 5, maxNights: 7, childrenExempt: true, exemptAge: 14,
};

// Imposta dovuta per una singola prenotazione, dato l'insieme di regole.
export function cityTaxForBooking(b: Booking, rules: CityTaxRules): { persons: number; taxable: number; tax: number } {
  // Persone paganti: se ho le età dei bambini uso la soglia (es. under 14 esenti); altrimenti il toggle "minori esenti".
  const payingKids = (b.childAges && b.childAges.length)
    ? b.childAges.filter((a) => a >= rules.exemptAge).length
    : (rules.childrenExempt ? 0 : b.children);
  const persons = b.cityTaxExempt ? 0 : b.adults + payingKids;
  const nN = nights(b.checkIn, b.checkOut);
  const taxable = Math.min(nN, rules.maxNights);
  let tax: number;
  if (rules.taxMode === "percentuale") {
    // Siracusa: (prezzo camera a notte ÷ n. ospiti) × %, con tetto € a persona/notte, × persone paganti × notti.
    const guestsTot = Math.max(1, b.adults + b.children);
    const nightlyRate = nN > 0 ? (b.total ?? 0) / nN : 0;
    const perPersonTax = Math.min((nightlyRate / guestsTot) * (rules.pct / 100), rules.cap);
    tax = Math.round(perPersonTax * persons * taxable * 100) / 100;
  } else {
    tax = persons * taxable * rules.amount;
  }
  return { persons, taxable, tax };
}

// Imposta totale dovuta su un insieme di prenotazioni (già filtrate per periodo/struttura).
export function cityTaxTotal(bookings: Booking[], rules: CityTaxRules): { total: number; persons: number; nights: number; count: number } {
  let total = 0, persons = 0, nightsSum = 0;
  for (const b of bookings) {
    const r = cityTaxForBooking(b, rules);
    total += r.tax; persons += r.persons; nightsSum += r.taxable;
  }
  return { total: Math.round(total * 100) / 100, persons, nights: nightsSum, count: bookings.length };
}
