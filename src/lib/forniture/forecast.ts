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
  const mine = bookings.filter((b) => b.structureId === structureId && b.status !== "cancelled");
  let arrivals = 0;
  let guestNights = 0;
  for (const b of mine) {
    const ci = toMs(b.checkIn);
    if (!isNaN(ci) && ci >= winStart && ci < winEnd) arrivals++;
    const nights = nightsInWindow(b.checkIn, b.checkOut, winStart, winEnd);
    if (nights > 0) guestNights += nights * Math.max(1, num(b.adults, 1) + num(b.children, 0));
  }

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
