// Logica PURA dell'invio server della disponibilità verso Channex (niente rete, niente storage): quali strutture/tipologie inviare
// dopo una prenotazione e come evitare di rimandare righe identiche. La usano pool-push.ts e i test.
import type { PoolConfig } from "./inventory-pool";

/** Prenotazione coinvolta dall'evento (arrivata, modificata o cancellata): struttura e, se nota, tipologia. */
export interface AvailTouch { structureId?: string | null; roomTypeId?: string | null }
/** Cosa inviare per una struttura: `roomTypeIds` null = tutte le tipologie mappate. */
export interface AvailPlanItem { structureId: string; roomTypeIds: string[] | null }

/**
 * Sceglie le strutture (e le tipologie) di cui inviare la disponibilità.
 *  - Struttura nel gruppo attivo: tutto il gruppo, tutte le tipologie (le camere fisiche sono condivise: una prenotazione sposta la disponibilità
 *    anche delle altre tipologie e dell'altra struttura).
 *  - Struttura fuori dal gruppo (o gruppo non attivo): solo quella struttura e solo le tipologie coinvolte.
 *  - Senza indicazioni (`touched` vuoto): gruppo attivo → il gruppo; altrimenti tutte le strutture mappate.
 * Si considerano solo le strutture con una mappatura Channex (`mapped`). Ordine stabile (prima le strutture del gruppo / come in `mapped`).
 */
export function planAvailabilityPush(pool: PoolConfig, mapped: string[], touched?: AvailTouch[]): AvailPlanItem[] {
  const isMapped = new Set(mapped);
  const poolIds = pool.enabled ? pool.structureIds.filter((s) => isMapped.has(s)) : [];
  const hits = (touched ?? []).filter((t) => t && t.structureId);
  if (hits.length === 0) {
    const all = poolIds.length ? poolIds : (pool.enabled ? [] : mapped);
    return all.map((structureId) => ({ structureId, roomTypeIds: null }));
  }
  const plan = new Map<string, Set<string> | null>(); // null = tutte le tipologie
  for (const t of hits) {
    const sid = String(t.structureId);
    if (pool.enabled && pool.structureIds.includes(sid)) { poolIds.forEach((p) => plan.set(p, null)); continue; }
    if (!isMapped.has(sid)) continue;
    if (plan.get(sid) === null) continue; // già "tutte"
    if (!t.roomTypeId) { plan.set(sid, null); continue; }
    const set = plan.get(sid) ?? new Set<string>();
    set.add(String(t.roomTypeId));
    plan.set(sid, set);
  }
  return Array.from(plan.entries()).map(([structureId, set]) => ({ structureId, roomTypeIds: set ? Array.from(set) : null }));
}

/** Restringe la mappatura di una struttura alle sole tipologie indicate (null = nessuna restrizione). */
export function restrictMapRooms<M extends { rooms?: Record<string, unknown> }>(map: M, roomTypeIds: string[] | null): M {
  if (!roomTypeIds || !map.rooms) return map;
  const keep = new Set(roomTypeIds);
  return { ...map, rooms: Object.fromEntries(Object.entries(map.rooms).filter(([id]) => keep.has(id))) };
}

// ── Confronto con l'ultimo invio (per non rimandare righe identiche) ──
// La cache sta nella memoria del processo e vale poco (TTL): serve ad assorbire raffiche di webhook ripetuti, NON a sostituire il full-sync.
// Un TTL breve limita il rischio che il valore in cache non sia più quello presente su Channex (es. inviato nel frattempo dal browser).
export const AVAIL_CACHE_TTL_MS = 90_000;
const AVAIL_CACHE_MAX = 20_000;
export type AvailCache = Map<string, { v: number; t: number }>;
type Row = { property_id: string; room_type_id: string; date: string; availability: number };
const rowKey = (r: Row) => `${r.property_id}|${r.room_type_id}|${r.date}`;

/** Le sole righe diverse dall'ultimo invio riuscito (e ancora valido). */
export function changedAvailRows<R extends Row>(rows: R[], cache: AvailCache, now: number, ttl = AVAIL_CACHE_TTL_MS): R[] {
  return rows.filter((r) => { const c = cache.get(rowKey(r)); return !(c && now - c.t <= ttl && c.v === r.availability); });
}

/** Da chiamare SOLO dopo un invio riuscito. Pulisce le voci scadute e limita la dimensione della cache. */
export function rememberAvailRows(rows: Row[], cache: AvailCache, now: number, ttl = AVAIL_CACHE_TTL_MS): void {
  rows.forEach((r) => cache.set(rowKey(r), { v: r.availability, t: now }));
  if (cache.size > AVAIL_CACHE_MAX / 2) cache.forEach((c, k) => { if (now - c.t > ttl) cache.delete(k); });
  if (cache.size > AVAIL_CACHE_MAX) cache.clear();
}
