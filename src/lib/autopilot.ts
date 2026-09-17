// Revenue Autopilot — motore di suggerimenti prezzo.
// Ogni giorno, per ogni tipologia, propone una tariffa in base a: occupazione,
// last-minute, buchi tra prenotazioni. Parte dalla tariffa del motore unico
// (rateForDay) e applica moltiplicatori entro i limiti (guardrail). Se l'autopilot
// è attivo, i suggerimenti si applicano da soli scrivendo gli override del calendario.
import type { Booking, RoomType, Unit } from "./types";
import { rateForDay, loadWeekendPct } from "./pricing";
import { shiftISO } from "./dates";

export interface AutopilotCfg {
  on: boolean;          // applica automaticamente
  horizonDays: number;  // giorni futuri da ottimizzare
  maxChangePct: number; // variazione massima vs tariffa base (±%)
  floorPct: number;     // pavimento: mai sotto questo % della base
  ceilPct: number;      // tetto: mai sopra questo % della base
  lastRun?: string;     // data ISO dell'ultima applicazione automatica (giornaliera)
}
export const DEFAULT_AUTOPILOT: AutopilotCfg = { on: false, horizonDays: 30, maxChangePct: 25, floorPct: 70, ceilPct: 180 };

// Mappa dei giorni ad alta richiesta (festivo/ponte/evento) per prezzi consapevoli.
export function highDemandMap(events: { from: string; to: string; name: string }[], holidays: Record<string, string>, bridges: Record<string, string>, fromISO: string, days: number): Map<string, string> {
  const m = new Map<string, string>();
  for (let d = 0; d < days; d++) { const iso = shiftISO(fromISO, d); if (holidays[iso]) m.set(iso, holidays[iso]); else if (bridges[iso]) m.set(iso, "Ponte"); }
  for (const e of events || []) { let iso = e.from; let guard = 0; while (iso < e.to && guard++ < 400) { m.set(iso, e.name); iso = shiftISO(iso, 1); } }
  return m;
}

const KEY = "spigolestay:autopilot";
export function loadAutopilot(): AutopilotCfg {
  if (typeof localStorage === "undefined") return { ...DEFAULT_AUTOPILOT };
  try { const r = localStorage.getItem(KEY); if (r) return { ...DEFAULT_AUTOPILOT, ...JSON.parse(r) }; } catch {}
  return { ...DEFAULT_AUTOPILOT };
}
export function saveAutopilot(cfg: AutopilotCfg) { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} }

export interface Suggestion {
  key: string;          // `${typeId}|${iso}`
  typeId: string; typeName: string; structureId: string; iso: string;
  base: number; current: number; suggested: number; deltaPct: number;
  occ: number;          // occupazione 0..100 della tipologia in quel giorno
  reasons: string[];
}

const activeOn = (b: Booking, iso: string) => b.status !== "cancelled" && b.channel !== "blocked" && b.checkIn <= iso && iso < b.checkOut;

// Occupazione di una tipologia in un giorno = camere occupate / camere disponibili.
function typeOccupancy(typeUnitIds: Set<string>, bookings: Booking[], iso: string): number {
  if (!typeUnitIds.size) return 0;
  const occ = bookings.filter((b) => b.unitId && typeUnitIds.has(b.unitId) && activeOn(b, iso)).length;
  return Math.round((occ / typeUnitIds.size) * 100);
}

export function computeSuggestions(
  bookings: Booking[], roomTypes: RoomType[], units: Unit[], rateOverrides: Record<string, number>,
  cfg: AutopilotCfg, todayISO: string, structureId: string,
  highDemand?: Map<string, string>, // iso → motivo (festivo/ponte/evento) per prezzi consapevoli
): Suggestion[] {
  const weekendPct = loadWeekendPct();
  const out: Suggestion[] = [];
  const types = roomTypes.filter((rt) => (structureId === "all" || rt.structureId === structureId) && units.some((u) => u.roomTypeId === rt.id && !u.outOfService));

  for (const rt of types) {
    const typeUnitIds = new Set(units.filter((u) => u.roomTypeId === rt.id && !u.outOfService).map((u) => u.id));
    for (let d = 0; d < cfg.horizonDays; d++) {
      const iso = shiftISO(todayISO, d);
      const base = rateForDay(rt.id, iso, roomTypes, {}, weekendPct);            // tariffa "pulita" (senza override)
      const current = rateForDay(rt.id, iso, roomTypes, rateOverrides, weekendPct); // tariffa attuale (con override)
      if (base <= 0) continue;

      const occ = typeOccupancy(typeUnitIds, bookings, iso);
      const occNext = typeOccupancy(typeUnitIds, bookings, shiftISO(iso, 1));
      const occPrev = typeOccupancy(typeUnitIds, bookings, shiftISO(iso, -1));

      let mult = 1; const reasons: string[] = [];
      // Occupazione
      if (occ >= 85) { mult *= 1.12; reasons.push(`Occupazione ${occ}%: alza`); }
      else if (occ >= 70) { mult *= 1.06; reasons.push(`Occupazione ${occ}%: alza leggero`); }
      else if (occ <= 30) { mult *= 0.92; reasons.push(`Occupazione ${occ}%: abbassa per riempire`); }
      // Last-minute (prossimi 3 giorni ancora scarichi)
      if (d <= 3 && occ < 50) { mult *= 0.93; reasons.push("Last-minute scarico"); }
      // Buco tra prenotazioni (giorno più libero dei vicini)
      if (occ < 100 && occPrev > occ && occNext > occ) { mult *= 0.90; reasons.push("Buco tra prenotazioni"); }
      // Alta richiesta: festivo / ponte / evento locale → alza (se non già scarico)
      const hd = highDemand?.get(iso);
      if (hd && occ >= 25) { mult *= 1.10; reasons.push(hd); }

      // Guardrail: variazione massima vs base + pavimento/tetto
      let suggested = Math.round(base * mult);
      const maxUp = base * (1 + cfg.maxChangePct / 100), maxDown = base * (1 - cfg.maxChangePct / 100);
      suggested = Math.min(maxUp, Math.max(maxDown, suggested));
      suggested = Math.min(base * (cfg.ceilPct / 100), Math.max(base * (cfg.floorPct / 100), suggested));
      suggested = Math.max(1, Math.round(suggested));

      const deltaPct = current > 0 ? Math.round(((suggested - current) / current) * 100) : 0;
      if (Math.abs(deltaPct) < 3 || suggested === current) continue; // ignora variazioni trascurabili

      out.push({ key: `${rt.id}|${iso}`, typeId: rt.id, typeName: rt.name, structureId: rt.structureId, iso, base, current, suggested, deltaPct, occ, reasons });
    }
  }
  // Prima i cambiamenti più grandi (in valore assoluto).
  return out.sort((a, b) => Math.abs(b.suggested - b.current) - Math.abs(a.suggested - a.current));
}

// Mappa override da applicare (key → prezzo).
export const toOverrideMap = (s: Suggestion[]): Record<string, number> => Object.fromEntries(s.map((x) => [x.key, x.suggested]));
