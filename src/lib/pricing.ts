// Prezzi: base effettiva con derivazione (guardia anti-ciclo) + risoluzione ereditarietà.
// Fonte unica usata da Tariffe, motore prenotazioni, nuova prenotazione, sito web.

import type { RoomType } from "./types";
import { parseISO, isWeekend } from "./dates";
import { lsGet } from "./publicdata";

export function effectiveBase(rt: RoomType, all: RoomType[], seen: Set<string> = new Set()): number {
  if (!rt.deriveFrom || seen.has(rt.id)) return rt.basePrice;
  seen.add(rt.id);
  const src = all.find((x) => x.id === rt.deriveFrom);
  if (!src) return rt.basePrice;
  const base = effectiveBase(src, all, seen);
  const v = rt.deriveValue ?? 0;
  const raw = rt.deriveMode === "percent" ? base * (1 + v / 100) : base + v;
  // Arrotondamento opzionale (default: sì). Con deriveRound === false si tiene il valore esatto.
  return Math.max(0, rt.deriveRound === false ? raw : Math.round(raw));
}
// Alias storico usato in alcune pagine.
export const effBase = effectiveBase;

// Segue la catena di derivazione quando la tipologia eredita (deriveInherit), altrimenti usa il valore proprio.
function resolveInherited<T>(rt: RoomType, all: RoomType[], pick: (r: RoomType) => T, seen: Set<string> = new Set()): T {
  if (rt.deriveFrom && rt.deriveInherit && !seen.has(rt.id)) {
    seen.add(rt.id);
    const src = all.find((x) => x.id === rt.deriveFrom);
    if (src) return resolveInherited(src, all, pick, seen);
  }
  return pick(rt);
}
export const effectiveMinStay = (rt: RoomType, all: RoomType[]) => resolveInherited(rt, all, (r) => r.minStay ?? 0);
export const effectiveClosed = (rt: RoomType, all: RoomType[]) => resolveInherited(rt, all, (r) => !!r.salesClosed);

export const isWeekendISO = (iso: string) => isWeekend(parseISO(iso));

// Maggiorazione weekend configurabile (regole prezzo in localStorage). Default 25%, attiva.
// Se l'interruttore è spento (weekendOn: false), la % effettiva è 0: ogni chiamante la applica
// già come "prezzo base × (1 + weekendPct/100)", quindi 0 la disattiva ovunque senza dover
// insegnare a ciascun punto d'uso il concetto di interruttore.
//
// INDIPENDENTE PER STRUTTURA: la forma storica `{weekendOn, weekendPct}` resta valida e vale
// come DEFAULT per tutte le strutture. In più si può salvare `byStructure: { [structureId]:
// { weekendOn?, weekendPct? } }`: una struttura con la propria voce usa quella, le altre
// continuano a usare il default.
export interface WeekendRule { weekendOn?: boolean; weekendPct?: number }
const RULES_KEY = "spigolestay:pricerules";

// Lettura tollerante da stringa grezza (localStorage, snapshot pubblico o dati server).
export function parseWeekendRules(raw: string | null | undefined): { def: WeekendRule; byStructure: Record<string, WeekendRule> } {
  try {
    if (raw) {
      const v = JSON.parse(raw);
      return { def: { weekendOn: v.weekendOn, weekendPct: v.weekendPct }, byStructure: (v.byStructure && typeof v.byStructure === "object") ? v.byStructure : {} };
    }
  } catch {}
  return { def: {}, byStructure: {} };
}
const effPct = (r: WeekendRule): number => (r.weekendOn === false ? 0 : (r.weekendPct ?? 25));

// % weekend effettiva da una stringa grezza, per una struttura (se ha la propria voce) o di default.
export function weekendPctFromRaw(raw: string | null | undefined, structureId?: string): number {
  const { def, byStructure } = parseWeekendRules(raw);
  const own = structureId ? byStructure[structureId] : undefined;
  // Campi mancanti nella voce della struttura → ricadono sul default.
  return own ? effPct({ weekendOn: own.weekendOn ?? def.weekendOn, weekendPct: own.weekendPct ?? def.weekendPct }) : effPct(def);
}
export function weekendOnFromRaw(raw: string | null | undefined, structureId?: string): boolean {
  const { def, byStructure } = parseWeekendRules(raw);
  const own = structureId ? byStructure[structureId] : undefined;
  return (own ? (own.weekendOn ?? def.weekendOn) : def.weekendOn) !== false;
}

function rawRules(): string | null {
  try { return lsGet(RULES_KEY); } catch { return null; }
}
export function loadWeekendPct(structureId?: string): number {
  return weekendPctFromRaw(rawRules(), structureId);
}
export function loadWeekendOn(structureId?: string): boolean {
  return weekendOnFromRaw(rawRules(), structureId);
}

// Cache per rateForDay (chiamata migliaia di volte per render): si ri-parsa solo se la stringa cambia.
let _cacheRaw: string | null | undefined = undefined;
let _cacheParsed: { def: WeekendRule; byStructure: Record<string, WeekendRule> } = { def: {}, byStructure: {} };
export function structureWeekendPct(structureId: string | undefined, fallback: number): number {
  if (!structureId) return fallback;
  const raw = rawRules();
  if (raw !== _cacheRaw) { _cacheRaw = raw; _cacheParsed = parseWeekendRules(raw); }
  const own = _cacheParsed.byStructure[structureId];
  if (!own) return fallback; // nessuna regola propria: vale quella passata dal chiamante (default)
  return effPct({ weekendOn: own.weekendOn ?? _cacheParsed.def.weekendOn, weekendPct: own.weekendPct ?? _cacheParsed.def.weekendPct });
}

// TARIFFA UNICA per (tipologia, giorno): override calendario (per tipo o per giorno),
// altrimenti base effettiva (con derivazione) + maggiorazione weekend. Usata da
// calendario, motore prenotazioni, revenue, preventivi, sito/widget.
export function rateForDay(typeId: string, iso: string, all: RoomType[], overrides: Record<string, number> = {}, weekendPct = 25, seen: Set<string> = new Set()): number {
  // 1) Override diretto (per quella tipologia e giorno, o per il giorno) → vince sempre.
  const ov = overrides[`${typeId}|${iso}`] ?? overrides[iso];
  if (ov != null) return Math.max(0, Math.round(ov));
  const rt = all.find((x) => x.id === typeId);
  if (!rt) return 0;
  // 2) Tipologia DERIVATA: segue il prezzo GIORNALIERO della madre (override del calendario
  //    inclusi) e applica la propria regola (% o +€). Così una modifica dal calendario sulla
  //    madre si propaga a tutte le derivate. Guardia anti-ciclo con `seen`.
  if (rt.deriveFrom && !seen.has(rt.id)) {
    seen.add(rt.id);
    const src = all.find((x) => x.id === rt.deriveFrom);
    if (src) {
      const motherDay = rateForDay(src.id, iso, all, overrides, weekendPct, seen);
      const v = rt.deriveValue ?? 0;
      const raw = rt.deriveMode === "percent" ? motherDay * (1 + v / 100) : motherDay + v;
      return Math.max(0, rt.deriveRound === false ? raw : Math.round(raw));
    }
  }
  // 3) Tipologia base: prezzo di listino + maggiorazione weekend.
  const base = effectiveBase(rt, all);
  const wk = structureWeekendPct(rt.structureId, weekendPct); // regola weekend della struttura della tipologia (se propria)
  return Math.max(0, Math.round(base * (isWeekendISO(iso) ? 1 + wk / 100 : 1)));
}
