// Prezzi: base effettiva con derivazione (guardia anti-ciclo) + risoluzione ereditarietà.
// Fonte unica usata da Tariffe, motore prenotazioni, nuova prenotazione, sito web.

import type { RoomType } from "./types";
import { parseISO, isWeekend } from "./dates";

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

// Maggiorazione weekend configurabile (regole prezzo in localStorage). Default 25%.
export function loadWeekendPct(): number {
  if (typeof localStorage === "undefined") return 25;
  try { const r = localStorage.getItem("spigolestay:pricerules"); if (r) return JSON.parse(r).weekendPct ?? 25; } catch {}
  return 25;
}

// TARIFFA UNICA per (tipologia, giorno): override calendario (per tipo o per giorno),
// altrimenti base effettiva (con derivazione) + maggiorazione weekend. Usata da
// calendario, motore prenotazioni, revenue, preventivi, sito/widget.
export function rateForDay(typeId: string, iso: string, all: RoomType[], overrides: Record<string, number> = {}, weekendPct = 25): number {
  const ov = overrides[`${typeId}|${iso}`] ?? overrides[iso];
  if (ov != null) return Math.max(0, Math.round(ov));
  const rt = all.find((x) => x.id === typeId);
  const base = rt ? effectiveBase(rt, all) : 0;
  return Math.max(0, Math.round(base * (isWeekendISO(iso) ? 1 + weekendPct / 100 : 1)));
}
