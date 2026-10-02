// ============================================================
//  Forniture — riordino suggerito (logica pura, testabile senza I/O).
//  Legge arrivi e ospiti·notti dalle prenotazioni confermate nell'orizzonte e,
//  per ogni prodotto con regola attiva, calcola il fabbisogno arrotondato al pack.
//
//  fabbisogno = arrivi × consumo/arrivo + ospiti_notti × consumo/ospite_notte
//               + safety_stock − giacenza
//  qty_ordine = ceil(fabbisogno / pack_size) × pack_size   (0 se ≤ 0)
// ============================================================

export interface FcBooking { structureId: string; checkIn: string; checkOut: string; status?: string; adults?: number; children?: number }
export interface FcProduct { id: string; pack_size?: number; consumption_per_arrival?: number; consumption_per_guest_night?: number }
export interface FcRule { product_id: string; enabled?: boolean; safety_stock?: number; horizon_days?: number }
export interface FcStock { product_id: string; qty_on_hand?: number }
export interface FcLine { product_id: string; arrivals: number; guestNights: number; need: number; qty: number; packSize: number }

const DAY = 86400000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// Notti di una prenotazione che cadono dentro la finestra [winStart, winEnd).
function nightsInWindow(ci: string, co: string, winStart: number, winEnd: number): number {
  const a = toMs(ci), b = toMs(co);
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  const s = Math.max(a, winStart), e = Math.min(b, winEnd);
  return e > s ? Math.round((e - s) / DAY) : 0;
}


// Arrivi e ospiti·notti di una struttura nella finestra [winStart, winEnd) (millisecondi UTC).
// Solo prenotazioni non cancellate. Condivisa tra riordino e stima delle scorte.
export function consumptionInWindow(bookings: FcBooking[], structureId: string, winStart: number, winEnd: number): { arrivals: number; guestNights: number } {
  let arrivals = 0;
  let guestNights = 0;
  for (const b of bookings) {
    if (b.structureId !== structureId || b.status === "cancelled") continue;
    const ci = toMs(b.checkIn);
    if (!isNaN(ci) && ci >= winStart && ci < winEnd) arrivals++;
    const nights = nightsInWindow(b.checkIn, b.checkOut, winStart, winEnd);
    if (nights > 0) guestNights += nights * Math.max(1, num(b.adults, 1) + num(b.children, 0));
  }
  return { arrivals, guestNights };
}

export interface ForecastInput {
  structureId: string;
  today: string;               // ISO YYYY-MM-DD
  horizonDays: number;         // orizzonte in giorni
  bookings: FcBooking[];
  products: FcProduct[];
  rules: FcRule[];
  stock?: FcStock[];
}

export function forecastConsumption(input: ForecastInput): FcLine[] {
  const { structureId, today, horizonDays, bookings, products, rules, stock = [] } = input;
  const winStart = toMs(today);
  const winEnd = winStart + Math.max(0, horizonDays) * DAY;
  const stockBy = new Map(stock.map((s) => [s.product_id, num(s.qty_on_hand)]));
  const ruleBy = new Map(rules.filter((r) => r.enabled !== false).map((r) => [r.product_id, r]));

  // Arrivi (check-in nella finestra) e ospiti·notti (notti nella finestra × occupazione),
  // solo per la struttura richiesta e prenotazioni non cancellate.
  const { arrivals, guestNights } = consumptionInWindow(bookings, structureId, winStart, winEnd);

  const lines: FcLine[] = [];
  for (const p of products) {
    const rule = ruleBy.get(p.id);
    if (!rule) continue; // solo prodotti con regola attiva
    const cpa = num(p.consumption_per_arrival);
    const cpgn = num(p.consumption_per_guest_night);
    const safety = num(rule.safety_stock);
    const onHand = num(stockBy.get(p.id));
    const pack = Math.max(1, num(p.pack_size, 1));
    const need = arrivals * cpa + guestNights * cpgn + safety - onHand;
    const qty = need > 0 ? Math.ceil(need / pack) * pack : 0;
    if (qty > 0) lines.push({ product_id: p.id, arrivals, guestNights, need: Math.round(need * 1000) / 1000, qty, packSize: pack });
  }
  return lines;
}

// ============================================================
//  Scorte — stima della giacenza di oggi e stato rispetto alla soglia minima.
//  La giacenza "contata" è l'ultimo valore salvato dall'utente (data = updated_at).
//  Da quella data si sottrae il consumo STIMATO dalle prenotazioni (arrivi e
//  ospiti·notti trascorsi): niente stato aggiuntivo, nessun doppio scarico.
// ============================================================
export type StockState = "ok" | "low" | "out" | "none";

export interface StockEstimate {
  counted: number;        // giacenza contata/caricata
  consumed: number;       // consumo stimato dalla data del conteggio a oggi
  estimated: number;      // stima di oggi (mai sotto zero)
  dailyRate: number;      // consumo medio giornaliero atteso (prossimi `horizonDays`)
  coverageDays: number | null; // giorni di copertura (null = consumo nullo/non stimabile)
}

// fromISO = data del conteggio (inclusa), todayISO = oggi (esclusa).
export function estimateStock(args: {
  bookings: FcBooking[]; structureId: string; product: FcProduct;
  counted: number; countedAtISO: string | null; todayISO: string; horizonDays?: number;
}): StockEstimate {
  const { bookings, structureId, product, counted, countedAtISO, todayISO } = args;
  const horizon = Math.max(1, args.horizonDays ?? 30);
  const cpa = num(product.consumption_per_arrival);
  const cpgn = num(product.consumption_per_guest_night);
  let consumed = 0;
  if (countedAtISO && countedAtISO < todayISO) {
    const w = consumptionInWindow(bookings, structureId, toMs(countedAtISO), toMs(todayISO));
    consumed = w.arrivals * cpa + w.guestNights * cpgn;
  }
  const estimated = Math.max(0, counted - consumed);
  const f = consumptionInWindow(bookings, structureId, toMs(todayISO), toMs(todayISO) + horizon * DAY);
  const dailyRate = (f.arrivals * cpa + f.guestNights * cpgn) / horizon;
  const coverageDays = dailyRate > 0 ? Math.floor(estimated / dailyRate) : null;
  return { counted, consumed: Math.round(consumed * 100) / 100, estimated: Math.round(estimated * 100) / 100, dailyRate, coverageDays };
}

// "none" = nessuna giacenza registrata e nessuna soglia: non monitorato.
export function stockState(estimated: number, min: number, tracked: boolean): StockState {
  if (!tracked) return "none";
  if (estimated <= 0) return "out";
  if (min > 0 && estimated <= min) return "low";
  return "ok";
}

// Quantità da ordinare per un prodotto sotto soglia: copre l'orizzonte + soglia minima,
// arrotondata al pack e mai sotto il minimo d'ordine.
export function reorderQty(args: { estimated: number; min: number; dailyRate: number; horizonDays: number; packSize?: number; minOrderQty?: number }): number {
  const pack = Math.max(1, num(args.packSize, 1));
  const need = args.dailyRate * Math.max(0, args.horizonDays) + Math.max(0, args.min) - Math.max(0, args.estimated);
  if (need <= 0) return 0;
  const q = Math.ceil(need / pack) * pack;
  return Math.max(q, Math.max(1, num(args.minOrderQty, 1)));
}
