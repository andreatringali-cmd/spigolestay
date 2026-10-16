// Calcolo UNICO del totale di una prenotazione, condiviso tra elenco, scheda e calendario,
// così il numero mostrato coincide ovunque.
//  Totale ospite = soggiorno (total) + pulizia (cleaningFee) + extra + tassa di soggiorno.
import { nights, shiftISO } from "./dates";
import { CHANNELS, type Channel, type ExtraService, type Structure } from "./types";
import { entryMatches, entryName, isActive, unitAmount } from "./upselling";
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

export type BookingLike = {
  id?: string; checkIn: string; checkOut: string; adults?: number; children?: number; childAges?: number[];
  total?: number; cleaningFee?: number; extras?: { price?: number }[]; cityTaxExempt?: boolean;
  /** tassa già incassata a parte (a mano): non fa parte del residuo (vedi incassi.ts) */
  cityTaxPaid?: boolean; cityTaxInPaid?: boolean;
};

// Persone paganti la tassa: adulti + minori NON esenti (età >= soglia comunale).
// Se non sono note le età dei bambini, si considerano esenti (comportamento prudente).
/** Imposta di soggiorno di una prenotazione: paganti = adulti + minori sopra la soglia, divisore = tutti gli ospiti. Un solo punto di calcolo per elenco, fatture, fascicolo, adempimenti e check-in. */
// Quote di tassa dei GRUPPI di camere (id prenotazione → quota), calcolate una volta sull'insieme delle camere e aggiornate dallo store a ogni modifica delle prenotazioni
// (setGroupTaxContext): così elenco, fatture, report e totali usano tutti la stessa cifra, senza che ogni schermata conosca i gruppi.
let groupTaxShares = new Map<string, number>();
export function setGroupTaxContext(bookings: (GroupTaxRow & { groupId?: string; status?: string; channel?: string; structureId?: string })[], structureOf: (id: string) => Structure | undefined): void {
  const groups = new Map<string, typeof bookings>();
  for (const b of bookings) {
    if (!b.groupId || !b.id || b.status === "cancelled" || b.status === "no_show" || b.channel === "blocked") continue;
    const k = b.groupId + "|" + (b.structureId ?? "");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(b);
  }
  const next = new Map<string, number>();
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const st = structureOf(rows[0].structureId ?? "");
    for (const r of rows) next.set(r.id!, cityTaxShareOf(st, rows, r.id!));
  }
  groupTaxShares = next;
}
/** Quota di tassa di questa prenotazione se fa parte di un gruppo di camere (altrimenti undefined). */
export const groupTaxShareOf = (id?: string): number | undefined => (id ? groupTaxShares.get(id) : undefined);
/** Imposta di una prenotazione SENZA quote di gruppo (calcolo base). */
export function cityTaxOfBookingRaw(structure: Structure | undefined, b: { adults?: number; children?: number; childAges?: number[]; checkIn: string; checkOut: string; total?: number; cityTaxExempt?: boolean }): number {
  const n = Math.max(0, Math.round((Date.parse(b.checkOut + "T00:00:00Z") - Date.parse(b.checkIn + "T00:00:00Z")) / 86400000));
  return cityTaxOf(structure, cityTaxPayers(structure, b), n, b.total ?? 0, b.cityTaxExempt, (b.adults ?? 0) + (b.children ?? 0));
}
export function cityTaxOfBooking(structure: Structure | undefined, b: { id?: string; adults?: number; children?: number; childAges?: number[]; checkIn: string; checkOut: string; total?: number; cityTaxExempt?: boolean }): number {
  const share = b.id ? groupTaxShares.get(b.id) : undefined; // camera di un gruppo: la sua quota della tassa calcolata sull'insieme
  return share !== undefined ? share : cityTaxOfBookingRaw(structure, b);
}
/** Riga di una prenotazione per il calcolo della tassa di GRUPPO (più camere prenotate insieme, stesso groupId). */
export type GroupTaxRow = { id?: string; adults?: number; children?: number; childAges?: number[]; checkIn: string; checkOut: string; total?: number; cityTaxExempt?: boolean };
const cents = (n: number) => Math.round(n * 100);
/**
 * Tassa di soggiorno di un GRUPPO di camere: si calcola UNA volta sull'insieme (adulti, minori e soggiorno di tutte le camere), non camera per camera: così il totale è quello
 * del Comune (arrotondato una volta sola) e il tetto a persona/notte tiene conto di tutti gli ospiti. Camere con date diverse: somma delle singole (nessuna unione possibile).
 */
export function cityTaxOfGroup(structure: Structure | undefined, rows: GroupTaxRow[]): number {
  if (rows.length === 0) return 0;
  if (rows.length === 1) return cityTaxOfBookingRaw(structure, rows[0]);
  const same = rows.every((r) => r.checkIn === rows[0].checkIn && r.checkOut === rows[0].checkOut);
  if (!same) return Math.round(rows.reduce((a, r) => a + cents(cityTaxOfBookingRaw(structure, r)), 0)) / 100;
  return cityTaxOfBookingRaw(structure, {
    adults: rows.reduce((a, r) => a + (r.adults ?? 0), 0), children: rows.reduce((a, r) => a + (r.children ?? 0), 0),
    childAges: rows.flatMap((r) => r.childAges ?? []), checkIn: rows[0].checkIn, checkOut: rows[0].checkOut,
    total: rows.reduce((a, r) => a + (r.total ?? 0), 0), cityTaxExempt: rows.every((r) => r.cityTaxExempt),
  });
}
/** Quota di UNA camera nella tassa del gruppo, in proporzione ai paganti, ai centesimi e in modo che le quote sommino ESATTAMENTE il totale del gruppo. */
export function cityTaxShareOf(structure: Structure | undefined, rows: GroupTaxRow[], id: string): number {
  if (rows.length <= 1) return cityTaxOfGroup(structure, rows);
  const total = cents(cityTaxOfGroup(structure, rows));
  const ordered = rows.map((r, i) => ({ r, i, w: r.cityTaxExempt ? 0 : cityTaxPayers(structure, r) })).sort((a, b) => String(a.r.id ?? a.i).localeCompare(String(b.r.id ?? b.i)));
  const sumW = ordered.reduce((a, x) => a + x.w, 0);
  const weights = sumW > 0 ? ordered.map((x) => x.w) : ordered.map(() => 1);
  const wTot = weights.reduce((a, w) => a + w, 0);
  const base = weights.map((w) => Math.floor((total * w) / wTot));
  let left = total - base.reduce((a, v) => a + v, 0);
  const order = weights.map((w, k) => ({ k, frac: (total * w) / wTot - base[k] })).sort((a, b) => b.frac - a.frac || a.k - b.k);
  for (const o of order) { if (left <= 0) break; base[o.k] += 1; left--; }
  const idx = ordered.findIndex((x) => x.r.id === id);
  return (idx < 0 ? 0 : base[idx]) / 100;
}

/** Residuo di ogni camera di un gruppo (soggiorno + pulizia + extra + QUOTA di tassa del gruppo − incassato), ai centesimi. */
export function groupRowBalances(structure: Structure | undefined, rows: (GroupTaxRow & { cleaningFee?: number; extras?: { price?: number }[]; paid?: number })[]): { id: string; balance: number; tax: number }[] {
  return rows.map((r, i) => {
    const tax = cityTaxShareOf(structure, rows, r.id ?? String(i));
    const grand = cents(r.total ?? 0) + cents(r.cleaningFee ?? 0) + cents(bookingExtrasTotal(r)) + cents(tax);
    return { id: r.id ?? String(i), tax, balance: Math.max(0, grand - cents(r.paid ?? 0)) / 100 };
  });
}

export function cityTaxPayers(structure: Structure | undefined, b: { adults?: number; childAges?: number[] }): number {
  const adults = b.adults ?? 0;
  const freeUnder = structure?.cityTaxChildFreeUnder ?? 18; // default: tutti i minorenni esenti
  const payingKids = (b.childAges ?? []).filter((a) => typeof a === "number" && a >= freeUnder).length;
  return adults + payingKids;
}

export function bookingExtrasTotal(b: { extras?: { price?: number }[] }): number {
  return Array.isArray(b.extras) ? b.extras.reduce((a, e) => a + (e?.price || 0), 0) : 0;
}

/**
 * Extra scelti dall'ospite nel check-in online: input NON fidato (POST anonimo). Si accettano SOLO extra attivi del catalogo della struttura, riconosciuti per id
 * (extraId/id) oppure per nome (anche con il suffisso " ×2" che aggiunge la pagina); nome e prezzo vengono dal server (prezzo unitario del catalogo × quantità,
 * con la stessa regola a notte/a persona/a soggiorno del resto dell'app), mai dal client. Quantità intera 1-20 (e non oltre il maxQty del catalogo),
 * prezzo sempre >= 0, nessun doppione nella richiesta né rispetto agli extra già presenti sulla prenotazione.
 */
export function sanitizeChosenExtras(
  raw: unknown, catalog: ExtraService[] | undefined,
  stay: { checkIn: string; checkOut: string; adults: number },
  existing: { name?: unknown; extraId?: unknown }[] = [],
): { name: string; price: number; extraId: string; qty: number }[] {
  const out: { name: string; price: number; extraId: string; qty: number }[] = [];
  if (!Array.isArray(raw)) return out;
  const cat = (catalog ?? []).filter((e) => e && typeof e.id === "string" && typeof e.name === "string" && isActive(e) && Number.isFinite(e.price) && e.price >= 0);
  const taken = new Set<string>();
  for (const it of raw.slice(0, 50)) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const id = typeof r.extraId === "string" ? r.extraId : typeof r.id === "string" ? r.id : "";
    const rawName = typeof r.name === "string" ? r.name : "";
    const suffix = /\s×\s?(\d+)$/u.exec(rawName);
    const base = rawName.replace(/\s×\s?\d+$/u, "").trim().toLowerCase();
    const ex = (id ? cat.find((e) => e.id === id) : undefined) ?? (base ? cat.find((e) => e.name.trim().toLowerCase() === base) : undefined);
    if (!ex || taken.has(ex.id)) continue;
    const q0 = Number(r.qty ?? suffix?.[1] ?? 1);
    if (!Number.isFinite(q0)) continue;
    const q = Math.min(20, Math.max(1, Math.round(ex.maxQty ?? 20)), Math.round(q0));
    if (q < 1) continue;
    if (existing.some((x) => entryMatches({ name: typeof x.name === "string" ? x.name : "", price: 0, extraId: typeof x.extraId === "string" ? x.extraId : undefined }, ex))) continue;
    taken.add(ex.id);
    out.push({ name: entryName(ex.name, q), price: Math.round(unitAmount(ex, stay) * q * 100) / 100, extraId: ex.id, qty: q });
  }
  return out;
}

// Totale "quanto paga l'ospite". Se non c'è un prezzo soggiorno (total), ritorna 0.
export function bookingGrandTotal(b: BookingLike, structure: Structure | undefined): number {
  const acc = b.total ?? 0;
  if (!acc) return 0;
  const clean = b.cleaningFee ?? 0;
  const tax = cityTaxOfBooking(structure, b); // quota di gruppo se è una camera di gruppo; altrimenti paganti = adulti + minori sopra soglia, divisore = tutti gli ospiti
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
type CommissionBookingLike = { total?: number; cleaningFee?: number; extras?: { price?: number }[]; channel: Channel; commissionPct?: number; commissionAmount?: number | null; paymentFee?: number | null; structureId?: string; netTotal?: boolean; extId?: string; otaCard?: { present?: boolean; balance?: number; currency?: string; charged?: boolean } };
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
/**
 * La commissione mostrata è una STIMA? Vero quando il portale non ha mandato la cifra esatta (commissionAmount) e nessuno ha scritto una percentuale a mano:
 * allora si usa la media reale delle altre prenotazioni dello stesso canale e struttura (vedi defaultCommissionInfo). Da dire sempre all'utente.
 */
export function commissionIsEstimate(b: CommissionBookingLike): boolean {
  if (isNetPayout(b) || b.channel === "direct" || b.channel === "blocked") return false;
  if (b.commissionAmount != null || b.commissionPct != null) return false;
  return commissionBaseOf(b) > 0;
}
export const COMMISSION_ESTIMATE_HINT = "Stima: il portale non ha mandato la commissione esatta di questa prenotazione, quindi si usa la media reale delle altre dello stesso canale. Scrivi la cifra vera per correggerla.";
/** Solo la commissione di intermediazione dell'OTA (senza il costo d'incasso). */
export function commissionBaseOf(b: CommissionBookingLike): number {
  if (isNetPayout(b)) return 0; // il totale è già netto: la commissione non si sottrae due volte
  if (b.commissionAmount != null) return b.commissionAmount;
  const pct = b.commissionPct ?? defaultCommissionInfo(b.channel, b.structureId).pct;
  return Math.round((b.total ?? 0) * pct) / 100; // ai centesimi, non all'euro intero
}
/** Commissioni totali trattenute dall'OTA: intermediazione + costo d'incasso (es. "Payment charge" di Booking.com). È la cifra della colonna Commissioni. */
export function commissionOf(b: CommissionBookingLike): number {
  return Math.round((commissionBaseOf(b) + paymentFeeOf(b) + otaAdjustmentOf(b)) * 100) / 100;
}
/**
 * Sconti che l'OTA applica da sé e che la commissione dichiarata non contiene (es. HotelBeds «Agency Booster» −5%): lo si vede perché la carta virtuale
 * (otaCard.balance, ancora DA addebitare, in euro) è più bassa del netto atteso (lordo − commissione − costo d'incasso). La carta è la cifra vera che si incassa,
 * quindi la differenza conta come trattenuta e il netto torna con la carta. 0 se non c'è carta, è già addebitata, la valuta non è euro, la cifra non è più bassa
 * (almeno 50 centesimi, per non inseguire arrotondamenti) o lo scarto è inverosimile (oltre metà del lordo: la carta potrebbe coprire solo una parte).
 */
export function otaAdjustmentOf(b: CommissionBookingLike): number {
  if (isNetPayout(b)) return 0;
  const c = b.otaCard;
  if (!c?.present || c.charged) return 0;
  if (c.currency && c.currency.toUpperCase() !== "EUR") return 0;
  const bal = c.balance;
  if (!(typeof bal === "number" && bal > 0)) return 0;
  const lordo = lordoOf(b);
  if (!lordo) return 0;
  const gap = lordo - commissionBaseOf(b) - paymentFeeOf(b) - bal;
  if (gap < 0.5 || gap > lordo / 2) return 0;
  return Math.round(gap * 100) / 100;
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
    // Notti senza tariffa dell'OTA (soggiorno prolungato a mano, total aumentato dopo l'import): si spartisce su di esse
    // quanto il totale ha in più rispetto alle notti note, invece di contarle 0.
    let known = 0, missing = 0;
    for (let d = b.checkIn; d < b.checkOut; d = shiftISO(d, 1)) { const r = b.nightlyRates[d]; if (typeof r === "number" && Number.isFinite(r)) known += r; else missing++; }
    const fill = missing > 0 ? Math.max(0, (b.total ?? 0) - known) / missing : 0;
    let sum = 0;
    for (let d = s; d < e; d = shiftISO(d, 1)) { const r = b.nightlyRates[d]; sum += typeof r === "number" && Number.isFinite(r) ? r : fill; }
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
