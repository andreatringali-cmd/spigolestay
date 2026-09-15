// Nèttare — motore prezzi dinamici. Calcola, per ogni tipologia e giorno, il prezzo consigliato
// con la scomposizione "perché questo prezzo" e applica i modificatori manuali della cella.
import type { Booking, CalEvent, RoomType, Unit } from "./types";
import { shiftISO, nights } from "./dates";
import { effectiveBase } from "./pricing";

export type Goal = "fill" | "revenue" | "balanced";
export type Risk = "prudente" | "bilanciato" | "aggressivo";
export type Strategy = { goal: Goal; risk: Risk; lastMinute: boolean; followMarket: boolean; events: boolean; minStay: boolean; minPrice: number | null; maxPrice: number | null };
export const DEFAULT_STRAT: Strategy = { goal: "balanced", risk: "bilanciato", lastMinute: true, followMarket: true, events: true, minStay: false, minPrice: null, maxPrice: null };
export const RISK_BAND: Record<Risk, [number, number]> = { prudente: [0.94, 1.12], bilanciato: [0.88, 1.30], aggressivo: [0.82, 1.55] };

/** Modificatori manuali di una cella (tipologia × giorno). */
export type Mod = { locked?: number | null; min?: number | null; max?: number | null; adj?: number | null; adjMode?: "eur" | "pct" };
export type Step = { label: string; amount: number; kind: "up" | "down" | "limit" };
export type DayInfo = { date: string; occ: number; sold: number; total: number; holiday?: string; bridge?: string; events: CalEvent[] };
export type Cell = {
  rtId: string; date: string;
  base: number; recommended: number; final: number;
  steps: Step[]; modSteps: Step[];
  occ: number; sold: number; total: number; adr: number;
  mod?: Mod; modSet: boolean; modActive: boolean; minNights: number;
};
export type Market = { cityHot: boolean; adrGap: number };

export const cellKey = (rtId: string, iso: string) => `${rtId}|${iso}`;
const dow = (iso: string) => new Date(iso + "T00:00:00").getDay();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const has = (v: number | null | undefined): v is number => v != null && !Number.isNaN(v);

export function hasMod(m?: Mod): boolean {
  return !!m && (has(m.locked) || has(m.min) || has(m.max) || (has(m.adj) && m.adj !== 0));
}

/** Applica i modificatori al prezzo consigliato. */
export function applyMod(rec: number, m: Mod | undefined, floor?: number): { final: number; steps: Step[] } {
  const steps: Step[] = [];
  let p = rec;
  if (m && has(m.locked)) return { final: Math.max(0, Math.round(m.locked)), steps: [{ label: "Prezzo bloccato", amount: Math.round(m.locked) - rec, kind: "limit" }] };
  if (m && has(m.adj) && m.adj !== 0) {
    const d = m.adjMode === "pct" ? p * (m.adj / 100) : m.adj;
    steps.push({ label: `Aumenta / diminuisci ${m.adj > 0 ? "+" : ""}${m.adj}${m.adjMode === "pct" ? "%" : " €"}`, amount: d, kind: d >= 0 ? "up" : "down" });
    p += d;
  }
  if (has(floor) && floor > 0 && p < floor) { steps.push({ label: "Prezzo minimo tipologia", amount: floor - p, kind: "limit" }); p = floor; }
  if (m && has(m.min) && p < m.min) { steps.push({ label: "Prezzo minimo", amount: m.min - p, kind: "limit" }); p = m.min; }
  if (m && has(m.max) && p > m.max) { steps.push({ label: "Prezzo massimo", amount: m.max - p, kind: "limit" }); p = m.max; }
  return { final: Math.max(0, Math.round(p)), steps };
}

type Input = {
  strat: Strategy;
  dates: string[];
  today: string;
  roomTypes: RoomType[];   // tipologie della struttura
  allRoomTypes: RoomType[]; // per le tariffe derivate
  units: Unit[];           // camere attive della struttura
  bookings: Booking[];     // prenotazioni valide della struttura
  events: CalEvent[];
  holidays: Record<string, string>;
  bridges: Record<string, string>;
  market: Market;
  structBase: number;      // prezzo base struttura (ADR recente o base tipologia principale)
  mods: Record<string, Mod>;
};

export function runNettare(inp: Input): { days: DayInfo[]; cells: Record<string, Cell> } {
  const { strat, roomTypes, units, bookings, market, structBase } = inp;
  const [lo, hi] = RISK_BAND[strat.risk];
  const total = units.length;
  const days: DayInfo[] = [];
  const cells: Record<string, Cell> = {};

  for (const D of inp.dates) {
    const i = Math.round((new Date(D + "T00:00:00").getTime() - new Date(inp.today + "T00:00:00").getTime()) / 86400000);
    const wd = dow(D);
    const inHouse = bookings.filter((b) => b.checkIn <= D && b.checkOut > D);
    const pickup = total ? inHouse.length / total : 0;
    const evs = inp.events.filter((e) => e.from <= D && e.to > D);
    const holiday = inp.holidays[D];
    const holidayNext = inp.holidays[shiftISO(D, 1)];
    const bridge = inp.bridges[D];
    days.push({ date: D, occ: pickup, sold: inHouse.length, total, holiday, bridge, events: evs });

    // segnali a livello struttura (moltiplicatori con etichetta)
    const mults: { label: string; m: number }[] = [];
    if (strat.events && (wd === 5 || wd === 6)) mults.push({ label: "Weekend", m: 1.12 });
    else if (wd === 0) mults.push({ label: "Domenica", m: 0.98 });
    if (strat.events && (holiday || holidayNext)) mults.push({ label: `Giorno festivo · ${holiday || holidayNext}`, m: 1.10 });
    else if (strat.events && bridge) mults.push({ label: `Ponte · ${bridge}`, m: 1.08 });
    if (strat.events && evs.length) mults.push({ label: `Evento · ${evs.map((e) => e.name).join(", ")}`, m: 1.15 });
    if (pickup >= 0.7) mults.push({ label: "Struttura quasi al completo", m: strat.goal === "revenue" ? 1.22 : 1.13 });
    else if (pickup <= 0.2 && i >= 0 && i <= 10 && strat.lastMinute) mults.push({ label: `Distanza dalla data · ancora vuoto a ${i} gg`, m: strat.goal === "fill" ? 0.86 : 0.93 });
    if (strat.followMarket && market.cityHot) mults.push({ label: "Città molto piena (Rete città)", m: 1.08 });
    if (strat.followMarket && market.adrGap > 0.05) mults.push({ label: "Sotto il prezzo medio della città", m: 1 + clamp(market.adrGap, 0, 0.15) });
    else if (strat.followMarket && market.adrGap < -0.08) mults.push({ label: "Sopra il prezzo medio della città", m: 0.96 });
    if (strat.events && strat.followMarket && market.cityHot && (wd === 5 || wd === 6)) mults.push({ label: "Picco: weekend + città piena", m: 1.05 });
    if (strat.goal === "fill") mults.push({ label: "Obiettivo: riempi", m: 0.97 });
    else if (strat.goal === "revenue") mults.push({ label: "Obiettivo: massimo ricavo", m: 1.03 });

    for (const rt of roomTypes) {
      const rtUnits = units.filter((u) => u.roomTypeId === rt.id).length;
      const rtIn = inHouse.filter((b) => b.roomTypeId === rt.id);
      const rtOcc = rtUnits ? rtIn.length / rtUnits : 0;
      const adr = rtIn.length ? Math.round(rtIn.reduce((s, b) => s + (b.total || 0) / Math.max(1, nights(b.checkIn, b.checkOut)), 0) / rtIn.length) : 0;
      const base = Math.max(0, effectiveBase(rt, inp.allRoomTypes)) || structBase;

      const all = [...mults];
      if (rtUnits > 0 && rtOcc >= 0.99 && pickup < 0.7) all.push({ label: "Tipologia esaurita", m: 1.05 });

      const steps: Step[] = [];
      let running = base, f = 1;
      for (const x of all) { const d = running * (x.m - 1); steps.push({ label: x.label, amount: d, kind: d >= 0 ? "up" : "down" }); running *= x.m; f *= x.m; }
      const fBand = clamp(f, lo, hi);
      if (fBand !== f) { steps.push({ label: `Limite profilo ${strat.risk}`, amount: base * fBand - running, kind: "limit" }); running = base * fBand; f = fBand; }
      // guardrail strategia (espresso sul prezzo base della struttura)
      if (structBase > 0) {
        let sp = structBase * f;
        if (has(strat.minPrice) && strat.minPrice > 0) sp = Math.max(sp, strat.minPrice);
        if (has(strat.maxPrice) && strat.maxPrice > 0) sp = Math.min(sp, strat.maxPrice);
        const fG = sp / structBase;
        if (Math.abs(fG - f) > 1e-9) { steps.push({ label: "Guardrail min / max", amount: base * fG - running, kind: "limit" }); running = base * fG; f = fG; }
      }
      const recommended = Math.max(0, Math.round(running));
      const mod = inp.mods[cellKey(rt.id, D)];
      const { final, steps: modSteps } = applyMod(recommended, mod, rt.minPrice);
      const minNights = strat.minStay ? (f >= 1.18 ? 3 : f >= 1.08 ? 2 : 1) : 1;
      cells[cellKey(rt.id, D)] = { rtId: rt.id, date: D, base, recommended, final, steps, modSteps, occ: rtOcc, sold: rtIn.length, total: rtUnits, adr, mod, modSet: hasMod(mod), modActive: final !== recommended, minNights };
    }
  }
  return { days, cells };
}
