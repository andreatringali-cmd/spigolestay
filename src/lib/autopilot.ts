// Revenue Autopilot — motore di suggerimenti prezzo.
// Ogni giorno, per ogni tipologia, propone una tariffa in base a: occupazione,
// last-minute, buchi tra prenotazioni. Parte dalla tariffa del motore unico
// (rateForDay) e applica moltiplicatori entro i limiti (guardrail). Se l'autopilot
// è attivo, i suggerimenti si applicano da soli scrivendo gli override del calendario.
import type { Booking, RoomType, Unit } from "./types";
import { rateForDay, loadWeekendPct, isWeekendISO } from "./pricing";
import { shiftISO } from "./dates";
import { zoneMultiplier, type MarketSignal } from "./market";

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

// Config INDIPENDENTE PER STRUTTURA. Forma salvata (retro-compatibile con la vecchia forma piatta):
//   { on, horizonDays, maxChangePct, floorPct, ceilPct, lastRun?,            ← DEFAULT per tutte le strutture
//     byStructure?: { [structureId]: Partial<AutopilotCfg> } }                ← sovrascritture della singola struttura
// Una struttura senza voce propria usa il default; una voce propria sovrascrive solo i campi presenti.
const KEY = "spigolestay:autopilot";
type StoredAutopilot = Partial<AutopilotCfg> & { byStructure?: Record<string, Partial<AutopilotCfg>> };
function readStored(): StoredAutopilot {
  if (typeof localStorage === "undefined") return {};
  try { const r = localStorage.getItem(KEY); if (r) { const v = JSON.parse(r); if (v && typeof v === "object") return v as StoredAutopilot; } } catch {}
  return {};
}
export function loadAutopilot(structureId?: string): AutopilotCfg {
  const { byStructure, ...def } = readStored();
  const own = structureId && byStructure ? byStructure[structureId] : undefined;
  return { ...DEFAULT_AUTOPILOT, ...def, ...(own ?? {}) };
}
// Salva una modifica (parziale o completa): con structureId nella voce di quella struttura, altrimenti nel default.
// Preserva tutto il resto (altre strutture, forma storica).
export function saveAutopilot(patch: Partial<AutopilotCfg>, structureId?: string) {
  try {
    const cur = readStored();
    if (structureId) {
      const by = { ...(cur.byStructure ?? {}) };
      by[structureId] = { ...(by[structureId] ?? {}), ...patch };
      localStorage.setItem(KEY, JSON.stringify({ ...cur, byStructure: by }));
    } else {
      localStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch }));
    }
  } catch {}
}

// Segnali REALI (nessun dato inventato) usati per generare la spiegazione in linguaggio
// naturale di una proposta (vedi lib/autopilot-explain.ts). Rispecchiano esattamente le
// condizioni che hanno pesato sul moltiplicatore, così la frase non può "raccontare"
// qualcosa che il motore non ha davvero calcolato.
export interface SuggestionSignals {
  occBand?: "alta" | "media-alta" | "bassa"; // fascia di occupazione che ha innescato una variazione
  weekend: boolean;                          // il giorno è sabato/domenica (maggiorazione weekend del motore prezzi)
  lastMinute: boolean;                       // pochi giorni al check-in e tipologia ancora scarica
  gap: boolean;                              // giorno più libero dei vicini (buco tra prenotazioni)
  highDemandLabel?: string;                  // festivo / ponte / evento reale applicato quel giorno
  zoneReasons: string[];                     // motivazioni del benchmark "Rete città" (solo se dati reali di zona presenti)
}

// Quale guardrail ha limitato la proposta (se nessuno: il motore non è stato frenato).
export type GuardrailKind = "maxUp" | "maxDown" | "ceil" | "floor" | "typeMin";
export const GUARDRAIL_LABEL: Record<GuardrailKind, string> = {
  maxUp: "variazione massima verso l'alto", maxDown: "variazione massima verso il basso",
  ceil: "tetto (% della base)", floor: "pavimento (% della base)", typeMin: "prezzo minimo della tipologia",
};

export interface Suggestion {
  key: string;          // `${typeId}|${iso}`
  typeId: string; typeName: string; structureId: string; iso: string;
  base: number; current: number; suggested: number; deltaPct: number;
  occ: number;          // occupazione 0..100 della tipologia in quel giorno
  rawSuggested: number; // tariffa che il motore avrebbe proposto SENZA guardrail
  limitedBy?: GuardrailKind; // guardrail che ha frenato la proposta (assente = nessuno)
  reasons: string[];
  signals: SuggestionSignals;
}

const activeOn = (b: Booking, iso: string) => b.status !== "cancelled" && b.channel !== "blocked" && b.checkIn <= iso && iso < b.checkOut;

// Occupazione di una tipologia in un giorno = camere occupate / camere disponibili.
// Una prenotazione senza camera ancora assegnata conta comunque sulla sua tipologia: ignorarla farebbe
// sembrare la tipologia più vuota di com'è e porterebbe a ribassi sbagliati.
function typeOccupancy(typeUnitIds: Set<string>, typeId: string, bookings: Booking[], iso: string): number {
  if (!typeUnitIds.size) return 0;
  const occ = bookings.filter((b) => (b.unitId ? typeUnitIds.has(b.unitId) : b.roomTypeId === typeId) && activeOn(b, iso)).length;
  return Math.round((occ / typeUnitIds.size) * 100);
}

export function computeSuggestions(
  bookings: Booking[], roomTypes: RoomType[], units: Unit[], rateOverrides: Record<string, number>,
  cfg: AutopilotCfg, todayISO: string, structureId: string,
  highDemand?: Map<string, string>, // iso → motivo (festivo/ponte/evento) per prezzi consapevoli
  signal?: MarketSignal,            // benchmark "Rete città" (usato solo se ha dati reali di zona)
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

      const occ = typeOccupancy(typeUnitIds, rt.id, bookings, iso);
      const occNext = typeOccupancy(typeUnitIds, rt.id, bookings, shiftISO(iso, 1));
      const occPrev = typeOccupancy(typeUnitIds, rt.id, bookings, shiftISO(iso, -1));

      let mult = 1; const reasons: string[] = [];
      let occBand: SuggestionSignals["occBand"];
      // Occupazione
      if (occ >= 85) { mult *= 1.12; reasons.push(`Occupazione ${occ}%: alza`); occBand = "alta"; }
      else if (occ >= 70) { mult *= 1.06; reasons.push(`Occupazione ${occ}%: alza leggero`); occBand = "media-alta"; }
      else if (occ <= 30) { mult *= 0.92; reasons.push(`Occupazione ${occ}%: abbassa per riempire`); occBand = "bassa"; }
      // Last-minute (prossimi 3 giorni ancora scarichi)
      const lastMinute = d <= 3 && occ < 50;
      if (lastMinute) { mult *= 0.93; reasons.push("Last-minute scarico"); }
      // Buco tra prenotazioni (giorno più libero dei vicini)
      const gap = occ < 100 && occPrev > occ && occNext > occ;
      if (gap) { mult *= 0.90; reasons.push("Buco tra prenotazioni"); }
      // Alta richiesta: festivo / ponte / evento locale → alza (se non già scarico)
      const hd = highDemand?.get(iso);
      const highDemandLabel = hd && occ >= 25 ? hd : undefined;
      if (highDemandLabel) { mult *= 1.10; reasons.push(highDemandLabel); }
      // Benchmark di zona (Rete città): attivo SOLO con dati reali di zona; stessa logica di Revenue/Nèttare.
      const z = zoneMultiplier(signal, occ / 100);
      if (z.mult !== 1) { mult *= z.mult; reasons.push(...z.reasons); }

      // Guardrail: variazione massima vs base + pavimento/tetto
      const rawSuggested = Math.max(1, Math.round(base * mult));
      let suggested = rawSuggested;
      let limitedBy: GuardrailKind | undefined;
      const maxUp = base * (1 + cfg.maxChangePct / 100), maxDown = base * (1 - cfg.maxChangePct / 100);
      if (suggested > maxUp) { suggested = maxUp; limitedBy = "maxUp"; }
      else if (suggested < maxDown) { suggested = maxDown; limitedBy = "maxDown"; }
      const ceil = base * (cfg.ceilPct / 100), floor = base * (cfg.floorPct / 100);
      if (suggested > ceil) { suggested = ceil; limitedBy = "ceil"; }
      else if (suggested < floor) { suggested = floor; limitedBy = "floor"; }
      suggested = Math.max(1, Math.round(suggested));
      // Prezzo minimo vendibile impostato sulla tipologia (Camere): mai proposto sotto.
      if (rt.minPrice && rt.minPrice > 0 && suggested < rt.minPrice) { suggested = Math.round(rt.minPrice); limitedBy = "typeMin"; }
      if (suggested === rawSuggested) limitedBy = undefined; // il guardrail non ha cambiato nulla

      const deltaPct = current > 0 ? Math.round(((suggested - current) / current) * 100) : 0;
      if (Math.abs(deltaPct) < 3 || suggested === current) continue; // ignora variazioni trascurabili

      const signals: SuggestionSignals = { occBand, weekend: isWeekendISO(iso), lastMinute, gap, highDemandLabel, zoneReasons: z.reasons };
      out.push({ key: `${rt.id}|${iso}`, typeId: rt.id, typeName: rt.name, structureId: rt.structureId, iso, base, current, suggested, deltaPct, occ, rawSuggested, limitedBy, reasons, signals });
    }
  }
  // Prima i cambiamenti più grandi (in valore assoluto).
  return out.sort((a, b) => Math.abs(b.suggested - b.current) - Math.abs(a.suggested - a.current));
}

// Mappa override da applicare (key → prezzo).
export const toOverrideMap = (s: Suggestion[]): Record<string, number> => Object.fromEntries(s.map((x) => [x.key, x.suggested]));
