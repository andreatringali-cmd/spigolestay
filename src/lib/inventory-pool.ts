// Camere condivise tra strutture: più strutture che mostrano le STESSE camere fisiche (es. le camere 5-8 di Spigolehouse sono anche Spigolerooms: in Xenora
// ci sono due volte, "5" in Spigolehouse e "#5" in Spigolerooms). La camera fisica si riconosce dal NUMERO nel nome dell'unità: "5" e "#5" sono la stessa camera.
// Una camera è occupata se è prenotata in QUALUNQUE struttura del gruppo; così la disponibilità di ogni tipologia conta solo le camere fisiche davvero libere
// (se la Junior Suite #8 è occupata, anche la "8" di Spigolehouse lo è).
// Modulo puro (niente rete, niente storage): lo usano l'invio ARI ai portali, il Calendario, il sito diretto e i test.

export const POOL_KEY = "spigolestay:inventorypool";

export interface PoolConfig {
  enabled: boolean;
  structureIds: string[]; // strutture che condividono le camere fisiche
  realRooms?: number;     // non più usato (versione precedente: tetto numerico); si ignora
}

export const POOL_DEF: PoolConfig = { enabled: false, structureIds: [] };

export function parsePool(raw: string | null | undefined): PoolConfig {
  try {
    const p = raw ? { ...POOL_DEF, ...JSON.parse(raw) } : { ...POOL_DEF };
    const ids = Array.isArray(p.structureIds) ? p.structureIds.filter((x: unknown) => typeof x === "string" && x) : [];
    return { enabled: !!p.enabled && ids.length >= 2, structureIds: ids };
  } catch { return { ...POOL_DEF }; }
}

type U = { id: string; name?: string; roomTypeId: string; structureId?: string; outOfService?: boolean };
type B = { status?: string; structureId?: string; roomTypeId?: string; unitId?: string | null; checkIn: string; checkOut: string };

/** La struttura fa parte di un gruppo attivo? */
export const inPool = (cfg: PoolConfig | undefined, structureId: string | undefined): boolean => !!cfg?.enabled && !!structureId && cfg.structureIds.includes(structureId);

/** Identità della camera fisica: il numero nel nome ("5", "#5", "Camera 5" → "5"); senza numero, la camera è solo sua. */
export const physicalKey = (u: { id: string; name?: string }): string => { const m = (u.name ?? "").match(/\d+/); return m ? String(Number(m[0])) : `u:${u.id}`; };

const covers = (b: { checkIn: string; checkOut: string }, iso: string) => b.checkIn <= iso && iso < b.checkOut;
const active = (b: B) => b.status !== "cancelled";

/** Occupazione per camera fisica del gruppo, con cache per giorno. */
export function poolOccupancy(cfg: PoolConfig, units: U[], bookings: B[]) {
  const keyOfUnit = new Map(units.map((u) => [u.id, physicalKey(u)]));
  // Prenotazioni attive del gruppo con camera assegnata: (camera fisica, date).
  const assigned = bookings.filter((b) => active(b) && b.unitId && inPool(cfg, b.structureId) && keyOfUnit.has(b.unitId)).map((b) => ({ key: keyOfUnit.get(b.unitId as string) as string, checkIn: b.checkIn, checkOut: b.checkOut }));
  const cache = new Map<string, Set<string>>();
  const occupiedAt = (iso: string): Set<string> => {
    let s = cache.get(iso);
    if (!s) { s = new Set(assigned.filter((a) => covers(a, iso)).map((a) => a.key)); cache.set(iso, s); }
    return s;
  };
  /** La camera fisica di questa unità è libera per tutte le notti del soggiorno [ci, co)? */
  const unitFreeForStay = (u: U, ci: string, co: string): boolean => {
    const k = keyOfUnit.get(u.id) ?? physicalKey(u);
    return !assigned.some((a) => a.key === k && a.checkIn < co && a.checkOut > ci);
  };
  /** Disponibilità di una tipologia in un giorno: camere (non fuori servizio) la cui camera fisica è libera, meno le prenotazioni senza camera, meno le chiusure. */
  const availFor = (typeId: string, iso: string, closed = 0): number => {
    const occ = occupiedAt(iso);
    const free = units.filter((u) => u.roomTypeId === typeId && !u.outOfService && !occ.has(keyOfUnit.get(u.id) ?? physicalKey(u))).length;
    const unassigned = bookings.filter((b) => active(b) && !b.unitId && b.roomTypeId === typeId && covers(b, iso)).length;
    return Math.max(0, free - unassigned - closed);
  };
  return { availFor, unitFreeForStay, occupiedAt };
}
