// Calcolo tassa/imposta di soggiorno — logica UNICA condivisa fra la pagina
// "Tassa di soggiorno" e l'azione "Elabora tutto" degli Adempimenti (niente duplicati).
// Regole di default = preset Comune di Siracusa.
import { nights } from "@/lib/dates";
import type { Booking, Structure } from "@/lib/types";

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

// Regole di una struttura, dalla sua configurazione (Strutture → Tassa di soggiorno), nel formato
// di questa pagina. null = tassa di soggiorno non attiva per la struttura. Le età dei minori e i
// default seguono lib/booking.ts (cityTaxOf / cityTaxPayers).
export function cityTaxRulesOf(st: Structure | undefined): CityTaxRules | null {
  if (!st?.cityTax) return null;
  const percent = st.cityTaxMode === "percent";
  return {
    taxMode: percent ? "percentuale" : "fisso",
    amount: st.cityTaxAmount ?? 2,
    pct: st.cityTaxPercent ?? 0,
    cap: st.cityTaxCap ?? 0, // 0 = nessun tetto
    maxNights: st.cityTaxMaxNights ?? (percent ? 7 : 3),
    childrenExempt: true,    // minori senza età nota: esenti (come booking.ts)
    exemptAge: st.cityTaxChildFreeUnder ?? 18,
  };
}

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
    const rawPerPerson = (nightlyRate / guestsTot) * (rules.pct / 100);
    const perPersonTax = rules.cap > 0 ? Math.min(rawPerPerson, rules.cap) : rawPerPerson; // cap 0 = nessun tetto
    tax = Math.round(perPersonTax * persons * taxable * 100) / 100;
  } else {
    tax = persons * taxable * rules.amount;
  }
  return { persons, taxable, tax };
}

// Come cityTaxTotal ma ogni prenotazione usa le regole della SUA struttura (strutture senza tassa: saltate).
export function cityTaxTotalByStructure(bookings: Booking[], getStructure: (id: string) => Structure | undefined): { total: number; persons: number; nights: number; count: number } {
  let total = 0, persons = 0, nightsSum = 0, count = 0;
  for (const b of bookings) {
    const rules = cityTaxRulesOf(getStructure(b.structureId));
    if (!rules) continue;
    const r = cityTaxForBooking(b, rules);
    total += r.tax; persons += r.persons; nightsSum += r.taxable; count++;
  }
  return { total: Math.round(total * 100) / 100, persons, nights: nightsSum, count };
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
