// Prezzi: base effettiva con derivazione (guardia anti-ciclo) + risoluzione ereditarietà.
// Fonte unica usata da Tariffe, motore prenotazioni, nuova prenotazione, sito web.

import type { RoomType } from "./types";

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
