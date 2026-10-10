// Disponibilità condivisa tra strutture: più strutture che si dividono le stesse camere fisiche (es. Spigolehouse e Spigolerooms: 8 camere reali,
// ma sui portali se ne mostrano di più per farsi trovare dai gruppi). La regola: a ogni data una struttura non può mostrare più camere di quante
// ne restano libere nel GRUPPO, cioè `realRooms` meno tutte le prenotazioni attive delle strutture del gruppo che coprono quel giorno.
// Modulo puro (niente rete, niente storage): lo usano l'invio ARI ai portali e i test.

export const POOL_KEY = "spigolestay:inventorypool";

export interface PoolConfig {
  enabled: boolean;
  structureIds: string[]; // strutture che condividono le camere
  realRooms: number;      // camere fisiche totali del gruppo
}

export const POOL_DEF: PoolConfig = { enabled: false, structureIds: [], realRooms: 0 };

export function parsePool(raw: string | null | undefined): PoolConfig {
  try {
    const p = raw ? { ...POOL_DEF, ...JSON.parse(raw) } : { ...POOL_DEF };
    const ids = Array.isArray(p.structureIds) ? p.structureIds.filter((x: unknown) => typeof x === "string" && x) : [];
    const real = typeof p.realRooms === "number" && Number.isFinite(p.realRooms) && p.realRooms > 0 ? Math.floor(p.realRooms) : 0;
    return { enabled: !!p.enabled && ids.length >= 2 && real > 0, structureIds: ids, realRooms: real };
  } catch { return { ...POOL_DEF }; }
}

type B = { status?: string; structureId?: string; checkIn: string; checkOut: string };

/** La struttura fa parte di un gruppo attivo? */
export const inPool = (cfg: PoolConfig | undefined, structureId: string): boolean => !!cfg?.enabled && cfg.structureIds.includes(structureId);

/** Camere ancora libere nel gruppo in quel giorno (mai sotto zero). Sono occupate tutte le prenotazioni non annullate delle strutture del gruppo, bloccate comprese. */
export function poolRemaining(cfg: PoolConfig, bookings: B[], iso: string): number {
  const used = bookings.filter((b) => b.status !== "cancelled" && b.structureId && cfg.structureIds.includes(b.structureId) && b.checkIn <= iso && iso < b.checkOut).length;
  return Math.max(0, cfg.realRooms - used);
}

/** Disponibilità da mostrare: quella della tipologia, ma mai più delle camere libere nel gruppo. Fuori dal gruppo resta invariata. */
export function capByPool(avail: number, cfg: PoolConfig | undefined, structureId: string, bookings: B[], iso: string): number {
  if (!cfg || !inPool(cfg, structureId)) return avail;
  return Math.min(avail, poolRemaining(cfg, bookings, iso));
}
