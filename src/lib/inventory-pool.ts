// Disponibilità di gruppo: più strutture mostrano le STESSE camere fisiche (es. Spigolehouse e Spigolerooms sono nello stesso edificio).
// Si imposta nella pagina "Disponibilità di gruppo": si scelgono le strutture del gruppo, Xenora riconosce le tipologie e accanto a ciascuna si indica il NUMERO
// DI CAMERE REALI. Le tipologie con lo stesso nome (es. "Deluxe" in due strutture) formano una famiglia e dividono le stesse camere reali.
// Disponibilità di una tipologia, per ogni giorno = il minore tra (camere che mostra - sue prenotazioni) e (camere reali della famiglia - prenotazioni di
// tutta la famiglia). Così una prenotazione su una struttura riduce la disponibilità dell'altra, sempre.
// Modulo puro (niente rete, niente storage): lo usano l'invio ARI ai portali, il Calendario, il sito diretto, la pagina di impostazione e i test.

export const POOL_KEY = "spigolestay:inventorypool";

export interface PoolConfig {
  enabled: boolean;
  structureIds: string[];              // strutture del gruppo
  rooms?: Record<string, number>;      // famiglia (nome normalizzato) → camere reali
  assign?: Record<string, string>;     // id tipologia → famiglia scelta a mano ("" = non condivisa); assente = per nome
  realRooms?: number;                  // non più usato (versione precedente)
}

export const POOL_DEF: PoolConfig = { enabled: false, structureIds: [] };

export function parsePool(raw: string | null | undefined): PoolConfig {
  try {
    const p = raw ? { ...POOL_DEF, ...JSON.parse(raw) } : { ...POOL_DEF };
    const ids: string[] = Array.isArray(p.structureIds) ? p.structureIds.filter((x: unknown) => typeof x === "string" && x) : [];
    const rooms: Record<string, number> = {};
    if (p.rooms && typeof p.rooms === "object") for (const [k, v] of Object.entries(p.rooms as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) rooms[k] = Math.floor(v);
    const assign: Record<string, string> = {};
    if (p.assign && typeof p.assign === "object") for (const [k, v] of Object.entries(p.assign as Record<string, unknown>)) if (typeof v === "string") assign[k] = v;
    return { enabled: !!p.enabled && ids.length >= 2, structureIds: ids, rooms, assign };
  } catch { return { ...POOL_DEF }; }
}

type RT = { id: string; name?: string; structureId?: string };
type U = { id: string; roomTypeId: string; outOfService?: boolean };
type B = { status?: string; roomTypeId?: string; unitId?: string | null; checkIn: string; checkOut: string };

/** La struttura fa parte di un gruppo attivo? */
export const inPool = (cfg: PoolConfig | undefined, structureId: string | undefined): boolean => !!cfg?.enabled && !!structureId && cfg.structureIds.includes(structureId);

/** Famiglia di default di una tipologia: il suo nome senza maiuscole, spazi e simboli ("Junior Suite" → "juniorsuite"). */
export const famKeyOf = (name?: string): string => (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export interface PoolListing { typeId: string; structureId: string; name: string; famKey: string; listed: number }
export interface PoolFamily { key: string; name: string; listings: PoolListing[]; real: number; suggested: number; set: boolean }

/** Tipologie delle strutture del gruppo con la famiglia a cui appartengono (scelta a mano, altrimenti per nome). Famiglia "" = non condivisa. */
export function poolListings(cfg: PoolConfig, roomTypes: RT[], units: U[]): PoolListing[] {
  return roomTypes
    .filter((r) => !!r.structureId && cfg.structureIds.includes(r.structureId))
    .map((r) => ({
      typeId: r.id, structureId: r.structureId as string, name: r.name ?? "",
      famKey: cfg.assign && r.id in cfg.assign ? (cfg.assign[r.id] as string) : famKeyOf(r.name),
      listed: units.filter((u) => u.roomTypeId === r.id && !u.outOfService).length,
    }))
    // tipologie senza camere non partecipano (non hanno nulla da mostrare)
    .filter((l) => l.listed > 0);
}

/** Famiglie riconosciute: camere reali = quelle indicate; se mancano, si propone la tipologia che ne mostra di più (da confermare). */
export function poolFamilies(cfg: PoolConfig, roomTypes: RT[], units: U[]): PoolFamily[] {
  const map = new Map<string, PoolListing[]>();
  poolListings(cfg, roomTypes, units).filter((l) => l.famKey).forEach((l) => { const a = map.get(l.famKey); if (a) a.push(l); else map.set(l.famKey, [l]); });
  return Array.from(map.entries()).map(([key, listings]) => {
    const suggested = Math.max(...listings.map((l) => l.listed));
    const set = cfg.rooms !== undefined && key in cfg.rooms;
    return { key, name: listings[0].name, listings, real: set ? (cfg.rooms as Record<string, number>)[key] : suggested, suggested, set };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const covers = (b: { checkIn: string; checkOut: string }, iso: string) => b.checkIn <= iso && iso < b.checkOut;

/** Disponibilità per tipologia e giorno tenendo conto delle camere reali condivise. `closed` (chiusure manuali) si sottrae dal risultato. */
export function poolOccupancy(cfg: PoolConfig, roomTypes: RT[], units: U[], bookings: B[]) {
  const listings = poolListings(cfg, roomTypes, units);
  const byType = new Map(listings.map((l) => [l.typeId, l]));
  const fams = new Map(poolFamilies(cfg, roomTypes, units).map((f) => [f.key, f]));
  // Una prenotazione conta per la tipologia della camera in cui sta ORA (se la camera è stata spostata o cambiata di tipologia, vale quella di adesso: è la riga in cui
  // la vedi nel Calendario); senza camera assegnata vale la tipologia scelta alla prenotazione.
  const typeOfUnit = new Map(units.map((u) => [u.id, u.roomTypeId]));
  const typeOf = (b: B): string | undefined => (b.unitId && typeOfUnit.get(b.unitId)) || b.roomTypeId;
  const active = bookings.filter((b) => b.status !== "cancelled" && (() => { const t = typeOf(b); return !!t && byType.has(t); })());
  const demandCache = new Map<string, Map<string, number>>(); // giorno → tipologia → prenotazioni
  const demandAt = (iso: string) => {
    let d = demandCache.get(iso);
    if (!d) { d = new Map(); active.forEach((b) => { if (covers(b, iso)) { const t = typeOf(b) as string; d!.set(t, (d!.get(t) ?? 0) + 1); } }); demandCache.set(iso, d); }
    return d;
  };
  const availFor = (typeId: string, iso: string, closed = 0): number => {
    const l = byType.get(typeId); if (!l) return 0;
    const d = demandAt(iso);
    const own = Math.max(0, l.listed - (d.get(typeId) ?? 0));
    const fam = l.famKey ? fams.get(l.famKey) : undefined;
    let k = own;
    if (fam) { const used = fam.listings.reduce((a, x) => a + (d.get(x.typeId) ?? 0), 0); k = Math.min(own, Math.max(0, fam.real - used)); }
    return Math.max(0, k - closed);
  };
  /** Si può accogliere una prenotazione di questa tipologia per tutte le notti [ci, co)? */
  const canSell = (typeId: string, ci: string, co: string): boolean => {
    for (let t = new Date(ci + "T00:00:00Z"); t.toISOString().slice(0, 10) < co; t.setUTCDate(t.getUTCDate() + 1)) if (availFor(typeId, t.toISOString().slice(0, 10)) < 1) return false;
    return true;
  };
  /** La tipologia partecipa al gruppo? */
  const includes = (typeId: string) => byType.has(typeId);
  return { availFor, canSell, includes };
}
