// Invio SERVER della disponibilità delle strutture che si dividono le camere (vedi inventory-pool.ts).
// Quando arriva una prenotazione senza che Xenora sia aperto in un browser (webhook di Channex, sito diretto), il browser non può ricalcolare la
// disponibilità dell'ALTRA struttura del gruppo: lo fa il server, con lo stesso calcolo di ChannexAutoSync (buildAriPayload) e solo per la disponibilità.
import { buildAriPayload, type ChxStructMap } from "@/lib/channex-ari";
import { POOL_KEY, parsePool } from "@/lib/inventory-pool";
import { channexEnabled, pushAvailability } from "@/lib/channex";
import type { Booking, RoomType, Unit } from "@/lib/types";

const DATA_KEY = "spigolestay:data:v1";
const MAP_KEY = "spigolestay:channexmap";
const CLOSES_KEY = "spigolestay:calcloses";
const DAYS = 120;

const parse = <T,>(raw: string | undefined, def: T): T => { try { return raw ? (JSON.parse(raw) as T) : def; } catch { return def; } };

/** Ricalcola e invia a Channex la disponibilità delle strutture del gruppo. Non lancia mai: ritorna quante righe ha inviato. */
export async function pushPoolAvailability(blob: Record<string, string>): Promise<{ pushed: number; skipped?: string }> {
  try {
    const pool = parsePool(blob[POOL_KEY]);
    if (!pool.enabled) return { pushed: 0, skipped: "gruppo non attivo" };
    if (!channexEnabled()) return { pushed: 0, skipped: "Channex non configurato" };
    const data = parse<{ roomTypes?: RoomType[]; units?: Unit[]; bookings?: Booking[]; rateOverrides?: Record<string, number> }>(blob[DATA_KEY], {});
    const maps = parse<Record<string, ChxStructMap>>(blob[MAP_KEY], {});
    const closes = parse<Record<string, number>>(blob[CLOSES_KEY], {});
    const roomTypes = Array.isArray(data.roomTypes) ? data.roomTypes : [];
    const units = Array.isArray(data.units) ? data.units : [];
    const bookings = Array.isArray(data.bookings) ? data.bookings : [];
    const values: { property_id: string; room_type_id: string; date: string; availability: number }[] = [];
    for (const sid of pool.structureIds) {
      const map = maps[sid];
      if (!map?.propertyId || !map.rooms) continue;
      const { availability } = buildAriPayload(map, sid, roomTypes, units, bookings, data.rateOverrides ?? {}, { days: DAYS, closes, pool });
      values.push(...availability);
    }
    if (!values.length) return { pushed: 0, skipped: "nessuna struttura collegata" };
    const res = await pushAvailability(values);
    return { pushed: res.ok ? values.length : 0, skipped: res.ok ? undefined : `errore Channex ${res.status}` };
  } catch (e) {
    return { pushed: 0, skipped: e instanceof Error ? e.message : "errore" };
  }
}

/** Come pushPoolAvailability, ma dopo aver risposto alla richiesta quando possibile (`after`), così il webhook/il sito non aspettano Channex. */
export async function schedulePoolPush(blob: Record<string, string>): Promise<void> {
  try {
    if (!parsePool(blob[POOL_KEY]).enabled) return;
    const { after } = await import("next/server");
    try { after(async () => { const r = await pushPoolAvailability(blob); console.log("[pool push]", JSON.stringify(r)); }); return; } catch { /* fuori da una richiesta: si attende qui */ }
    const r = await pushPoolAvailability(blob); console.log("[pool push]", JSON.stringify(r));
  } catch { /* mai bloccare il chiamante */ }
}
