// Camere condivise tra strutture: più strutture mostrano le STESSE camere fisiche (es. le camere 5-8 di Spigolehouse sono anche Spigolerooms).
// Il collegamento è per TIPOLOGIA, non per numero di camera: le camere della stessa tipologia sono intercambiabili e si possono spostare.
//  - Le tipologie con lo stesso nome (es. "Deluxe" in Spigolehouse e in Spigolerooms) pescano dalle STESSE camere fisiche: quante sono si ricava dai numeri
//    delle camere (1,3,4,5,6,7 = 6 Deluxe, anche se la Deluxe di Spigolehouse ne mostra 7 e quella di Spigolerooms 3).
//  - Un numero che compare con tipologie DIVERSE (la "8" è Deluxe in Spigolehouse e Junior Suite in Spigolerooms) è la camera della tipologia con meno camere
//    (la Junior Suite): non si conta tra le Deluxe e le due tipologie non si scambiano camere.
//  - Disponibilità di una tipologia = quante prenotazioni in più si potrebbero ancora accogliere con le camere fisiche del gruppo.
// Modulo puro (niente rete, niente storage): lo usano l'invio ARI ai portali, il Calendario, il sito diretto e i test.

export const POOL_KEY = "spigolestay:inventorypool";

export interface PoolConfig {
  enabled: boolean;
  structureIds: string[]; // strutture che condividono le camere fisiche
  realRooms?: number;     // non più usato (versione precedente); si ignora
}

export const POOL_DEF: PoolConfig = { enabled: false, structureIds: [] };

export function parsePool(raw: string | null | undefined): PoolConfig {
  try {
    const p = raw ? { ...POOL_DEF, ...JSON.parse(raw) } : { ...POOL_DEF };
    const ids = Array.isArray(p.structureIds) ? p.structureIds.filter((x: unknown) => typeof x === "string" && x) : [];
    return { enabled: !!p.enabled && ids.length >= 2, structureIds: ids };
  } catch { return { ...POOL_DEF }; }
}

type RT = { id: string; name?: string; structureId?: string };
type U = { id: string; name?: string; roomTypeId: string; outOfService?: boolean };
type B = { status?: string; roomTypeId?: string; checkIn: string; checkOut: string };

/** La struttura fa parte di un gruppo attivo? */
export const inPool = (cfg: PoolConfig | undefined, structureId: string | undefined): boolean => !!cfg?.enabled && !!structureId && cfg.structureIds.includes(structureId);

/** Identità della camera dal numero nel nome ("5", "#5", "Camera 05" → "5"); senza numero, la camera è solo sua. */
export const physicalKey = (u: { id: string; name?: string }): string => { const m = (u.name ?? "").match(/\d+/); return m ? String(Number(m[0])) : `u:${u.id}`; };

const famName = (n?: string) => (n ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const covers = (b: { checkIn: string; checkOut: string }, iso: string) => b.checkIn <= iso && iso < b.checkOut;

/** Grafo delle camere condivise e disponibilità per tipologia/giorno. `closed` (chiusure manuali) si sottrae dal risultato. */
export function poolOccupancy(cfg: PoolConfig, roomTypes: RT[], units: U[], bookings: B[]) {
  const types = roomTypes.filter((r) => inPool(cfg, r.structureId));
  const tIndex = new Map(types.map((t, i) => [t.id, i]));
  const typeUnits = types.map((t) => units.filter((u) => u.roomTypeId === t.id && !u.outOfService));
  // Per ogni numero di camera: con quali nomi di tipologia compare e quante camere ha ciascun nome nel gruppo.
  const unitsByName = new Map<string, number>();
  types.forEach((t, i) => unitsByName.set(famName(t.name), (unitsByName.get(famName(t.name)) ?? 0) + typeUnits[i].length));
  const namesByKey = new Map<string, Set<string>>();
  types.forEach((t, i) => typeUnits[i].forEach((u) => { const k = physicalKey(u); if (!namesByKey.has(k)) namesByKey.set(k, new Set()); namesByKey.get(k)!.add(famName(t.name)); }));
  // Tipologia "vera" di ogni numero: se compare con più nomi, quella con meno camere nel gruppo (la Junior Suite, non la Deluxe "virtuale").
  const nativeOf = new Map<string, string>();
  namesByKey.forEach((names, k) => nativeOf.set(k, Array.from(names).sort((a, b) => (unitsByName.get(a) ?? 0) - (unitsByName.get(b) ?? 0) || a.localeCompare(b))[0]));
  const families = Array.from(new Set(nativeOf.values()));
  const fIndex = new Map(families.map((f, i) => [f, i]));
  const physical = families.map(() => 0);
  nativeOf.forEach((fam) => { physical[fIndex.get(fam) as number]++; });
  // Le tipologie diverse NON si scambiano camere: la "8" è la Junior Suite, una tipologia a sé, e non conta come Deluxe di Spigolehouse
  // (la Deluxe di Spigolehouse ne mostra 7 in Xenora, ma le Deluxe fisiche sono 6). `alias` resta vuoto: nessuna camera "in più" tra famiglie.
  const alias = types.map(() => new Map<number, number>());
  const own = types.map((t) => fIndex.get(famName(t.name)));

  // Le prenotazioni già presenti riempiono PRIMA le camere della propria famiglia (la Deluxe di Spigolehouse e quella di Spigolerooms dividono le 6 Deluxe);
  // solo se la famiglia è piena, la tipologia che ha camere "in più" (la Deluxe di Spigolehouse con la camera 8) usa quelle dell'altra famiglia (la Junior Suite).
  // Per le prenotazioni NUOVE è prudente: una tipologia senza camere in più (Deluxe di Spigolerooms) conta solo le camere della propria famiglia, e le camere in più
  // le può usare soltanto la tipologia che le ha. Così due tipologie non si vendono mai la stessa camera di scorta con una sola vendita.
  const place = (d: number[]) => {
    const load = families.map(() => 0);
    d.forEach((n, i) => { if (own[i] !== undefined) load[own[i] as number] += n; });
    const spill = families.map(() => 0);
    const spillBy = types.map(() => 0);
    for (let f = 0; f < families.length; f++) {
      let remaining = Math.max(0, load[f] - physical[f]);
      types.forEach((_, i) => {
        if (own[i] !== f || remaining === 0) return;
        let usable = d[i];
        alias[i].forEach((cap, g) => { const use = Math.min(remaining, usable, cap); spill[g] += use; spillBy[i] += use; remaining -= use; usable -= use; });
      });
      if (remaining > 0) return null;
    }
    return { load, spill, spillBy };
  };

  const active = bookings.filter((b) => b.status !== "cancelled" && b.roomTypeId && tIndex.has(b.roomTypeId));
  const demandCache = new Map<string, number[]>();
  const demandAt = (iso: string): number[] => {
    let d = demandCache.get(iso);
    if (!d) { d = types.map(() => 0); active.forEach((b) => { if (covers(b, iso)) d![tIndex.get(b.roomTypeId as string) as number]++; }); demandCache.set(iso, d); }
    return d;
  };
  const availCache = new Map<string, number>();
  /** Quante prenotazioni in più di questa tipologia si possono ancora accogliere quel giorno (meno le chiusure manuali). */
  const availFor = (typeId: string, iso: string, closed = 0): number => {
    const i = tIndex.get(typeId); if (i === undefined) return 0;
    const ck = `${typeId}|${iso}`; let k = availCache.get(ck);
    if (k === undefined) {
      const d = demandAt(iso);
      const base = place(d);
      if (!base) k = 0;
      else {
        const free = families.map((_, g) => physical[g] - Math.min(base.load[g], physical[g]) - base.spill[g]); // camere libere per famiglia
        const f = own[i] as number | undefined;
        let room = f === undefined ? 0 : Math.max(0, free[f]);
        // camere in più della tipologia (solo lei le usa), dentro ciò che l'altra famiglia ha ancora libero
        let extra = 0;
        alias[i].forEach((cap, g) => { extra += Math.max(0, Math.min(cap - base.spillBy[i], free[g])); });
        k = Math.min(Math.max(0, typeUnits[i].length - d[i]), room + extra);
      }
      availCache.set(ck, k);
    }
    return Math.max(0, k - closed);
  };
  /** Si può accogliere una prenotazione di questa tipologia per tutte le notti [ci, co)? */
  const canSell = (typeId: string, ci: string, co: string): boolean => {
    for (let t = new Date(ci + "T00:00:00Z"); t.toISOString().slice(0, 10) < co; t.setUTCDate(t.getUTCDate() + 1)) if (availFor(typeId, t.toISOString().slice(0, 10)) < 1) return false;
    return true;
  };
  /** Per l'interfaccia: camere fisiche per tipologia. */
  const summary = () => families.map((f, i) => ({ name: f, rooms: physical[i] }));
  return { availFor, canSell, summary };
}
