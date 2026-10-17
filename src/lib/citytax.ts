// Calcolo tassa/imposta di soggiorno — logica UNICA condivisa fra la pagina "Tassa di soggiorno",
// l'azione "Elabora tutto" degli Adempimenti, il check-in, le fatture e il fascicolo fiscale:
// l'importo di una prenotazione è sempre quello di `cityTaxOfBooking` (lib/booking.ts), che conosce le quote dei GRUPPI di camere,
// le età dei bambini (esenzione sotto la soglia del Comune) e il tetto a persona/notte. Qui si traducono solo le "regole" della pagina
// (modificabili per simulazione) in una struttura equivalente.
// DEFAULT_CITY_TAX_RULES = preset Comune di Siracusa, usato SOLO come punto di partenza della simulazione nella pagina "Tassa di soggiorno" (struttura senza regole).
// La soglia d'età di una struttura SENZA valore impostato e' DEFAULT_CITY_TAX_FREE_UNDER (lib/booking.ts), la stessa di totali, fatture e check-in.
import { nights } from "@/lib/dates";
import { cityTaxOfBooking, cityTaxOfBookingRaw, cityTaxPayers, DEFAULT_CITY_TAX_FREE_UNDER } from "@/lib/booking";
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
// di questa pagina. null = tassa di soggiorno non attiva per la struttura. Se la soglia d'età dei minori non è impostata
// vale DEFAULT_CITY_TAX_FREE_UNDER (18, come lib/booking.ts): cosi' pagina, adempimenti e totali dell'ospite danno lo stesso importo.
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
    exemptAge: st.cityTaxChildFreeUnder ?? DEFAULT_CITY_TAX_FREE_UNDER,
  };
}

const sameRules = (a: CityTaxRules, b: CityTaxRules) =>
  a.taxMode === b.taxMode && a.amount === b.amount && a.pct === b.pct && a.cap === b.cap && a.maxNights === b.maxNights && a.exemptAge === b.exemptAge;

/** Struttura equivalente alle regole date (per riusare il calcolo condiviso di lib/booking.ts). */
export function structureFromRules(r: CityTaxRules): Structure {
  return {
    cityTax: true, cityTaxMode: r.taxMode === "percentuale" ? "percent" : "fixed", cityTaxPercent: r.pct, cityTaxCap: r.cap,
    cityTaxAmount: r.amount, cityTaxMaxNights: r.maxNights, cityTaxChildFreeUnder: r.exemptAge,
  } as unknown as Structure;
}


/**
 * Imposta dovuta per una singola prenotazione, dato l'insieme di regole.
 * Con `structure` e regole uguali a quelle della struttura il calcolo è IDENTICO a quello di check-in, fatture e fascicolo (`cityTaxOfBooking`, quote di gruppo incluse);
 * con regole modificate a mano (simulazione) si calcola la prenotazione da sola con le regole indicate.
 */
export function cityTaxForBooking(b: Booking, rules: CityTaxRules, structure?: Structure): { persons: number; taxable: number; tax: number } {
  const real = structure?.cityTax && sameRules(cityTaxRulesOf(structure)!, rules) ? structure : null;
  const st = real ?? structureFromRules(rules);
  // Toggle "minori esenti (senza età)" spento: i bambini di cui non si conosce l'età pagano (età fittizia sopra qualunque soglia).
  const bb = !rules.childrenExempt && !(b.childAges && b.childAges.length) && b.children > 0
    ? { ...b, childAges: Array.from({ length: b.children }, () => 99) }
    : b;
  const persons = b.cityTaxExempt ? 0 : cityTaxPayers(st, bb);
  const taxable = Math.min(nights(b.checkIn, b.checkOut), rules.maxNights);
  const tax = real ? cityTaxOfBooking(st, bb) : cityTaxOfBookingRaw(st, bb);
  return { persons, taxable, tax };
}

const isLiveBooking = (b: Booking) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked";

// Come cityTaxTotal ma ogni prenotazione usa le regole della SUA struttura (strutture senza tassa: saltate). Annullate, no-show e blocchi non contano.
export function cityTaxTotalByStructure(bookings: Booking[], getStructure: (id: string) => Structure | undefined): { total: number; persons: number; nights: number; count: number } {
  let total = 0, persons = 0, nightsSum = 0, count = 0;
  for (const b of bookings) {
    if (!isLiveBooking(b)) continue;
    const st = getStructure(b.structureId);
    const rules = cityTaxRulesOf(st);
    if (!rules) continue;
    const r = cityTaxForBooking(b, rules, st);
    total += r.tax; persons += r.persons; nightsSum += r.taxable; count++;
  }
  return { total: Math.round(total * 100) / 100, persons, nights: nightsSum, count };
}

// Imposta totale dovuta su un insieme di prenotazioni (già filtrate per periodo/struttura).
export function cityTaxTotal(bookings: Booking[], rules: CityTaxRules, structure?: Structure): { total: number; persons: number; nights: number; count: number } {
  let total = 0, persons = 0, nightsSum = 0, count = 0;
  for (const b of bookings) {
    if (!isLiveBooking(b)) continue;
    const r = cityTaxForBooking(b, rules, structure);
    total += r.tax; persons += r.persons; nightsSum += r.taxable; count++;
  }
  return { total: Math.round(total * 100) / 100, persons, nights: nightsSum, count };
}
