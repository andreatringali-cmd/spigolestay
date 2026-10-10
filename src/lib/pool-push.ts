// Invio SERVER della disponibilità verso Channex (vedi anche inventory-pool.ts per le strutture che si dividono le camere).
// Quando arriva una prenotazione senza che Xenora sia aperto in un browser (webhook di Channex, sito diretto), il browser non può ricalcolare la
// disponibilità: lo fa il server, con lo stesso calcolo di ChannexAutoSync (buildAriPayload) e solo per la disponibilità (mai prezzi).
//  - Gruppo "disponibilità condivisa" attivo: si inviano tutte le strutture del gruppo (come prima).
//  - Gruppo non attivo: si inviano comunque le strutture mappate su Channex, ma solo quelle coinvolte dalla prenotazione e solo le tipologie coinvolte
//    (Channex limita a 20 chiamate/min). Una sola chiamata pushAvailability per evento, senza le righe identiche all'ultimo invio.
import { buildAriPayload, type ChxStructMap } from "@/lib/channex-ari";
import { POOL_KEY, parsePool } from "@/lib/inventory-pool";
import { channexEnabled, pushAvailability } from "@/lib/channex";
import { planAvailabilityPush, restrictMapRooms, changedAvailRows, rememberAvailRows, type AvailCache, type AvailTouch } from "@/lib/avail-push-plan";
import type { Booking, RoomType, Unit } from "@/lib/types";

const DATA_KEY = "spigolestay:data:v1";
const MAP_KEY = "spigolestay:channexmap";
const CLOSES_KEY = "spigolestay:calcloses";
const DAYS = 120;

// Ultimo invio riuscito (memoria del processo, vedi avail-push-plan.ts): per non rimandare righe identiche in una raffica di webhook.
const lastSent: AvailCache = new Map();

const parse = <T,>(raw: string | undefined, def: T): T => { try { return raw ? (JSON.parse(raw) as T) : def; } catch { return def; } };

/**
 * Ricalcola e invia a Channex la disponibilità. `touched` = struttura/tipologia delle prenotazioni coinvolte (se mancante: tutto il gruppo, o tutte le strutture mappate).
 * Non lancia mai: ritorna quante righe ha inviato.
 */
export async function pushPoolAvailability(blob: Record<string, string>, touched?: AvailTouch[]): Promise<{ pushed: number; skipped?: string }> {
  try {
    if (!channexEnabled()) return { pushed: 0, skipped: "Channex non configurato" };
    const pool = parsePool(blob[POOL_KEY]);
    const maps = parse<Record<string, ChxStructMap>>(blob[MAP_KEY], {});
    const mapped = Object.keys(maps).filter((sid) => maps[sid]?.propertyId && maps[sid].rooms);
    const plan = planAvailabilityPush(pool, mapped, touched);
    if (!plan.length) return { pushed: 0, skipped: mapped.length ? "struttura non coinvolta" : "nessuna struttura collegata" };
    const data = parse<{ roomTypes?: RoomType[]; units?: Unit[]; bookings?: Booking[]; rateOverrides?: Record<string, number> }>(blob[DATA_KEY], {});
    const closes = parse<Record<string, number>>(blob[CLOSES_KEY], {});
    const roomTypes = Array.isArray(data.roomTypes) ? data.roomTypes : [];
    const units = Array.isArray(data.units) ? data.units : [];
    const bookings = Array.isArray(data.bookings) ? data.bookings : [];
    const values: { property_id: string; room_type_id: string; date: string; availability: number }[] = [];
    for (const item of plan) {
      // Il gruppo attivo passa sempre `pool` (disponibilità sulle camere fisiche condivise); la restrizione alle tipologie vale solo fuori dal gruppo.
      const map = restrictMapRooms(maps[item.structureId], item.roomTypeIds);
      const { availability } = buildAriPayload(map, item.structureId, roomTypes, units, bookings, data.rateOverrides ?? {}, { days: DAYS, closes, pool });
      values.push(...availability);
    }
    if (!values.length) return { pushed: 0, skipped: "nessuna struttura collegata" };
    const now = Date.now();
    const toSend = changedAvailRows(values, lastSent, now);
    if (!toSend.length) return { pushed: 0, skipped: "disponibilità invariata" };
    const res = await pushAvailability(toSend);
    if (res.ok) rememberAvailRows(toSend, lastSent, now);
    return { pushed: res.ok ? toSend.length : 0, skipped: res.ok ? undefined : `errore Channex ${res.status}` };
  } catch (e) {
    return { pushed: 0, skipped: e instanceof Error ? e.message : "errore" };
  }
}

/** Come pushPoolAvailability, ma dopo aver risposto alla richiesta quando possibile (`after`), così il webhook/il sito non aspettano Channex. */
export async function schedulePoolPush(blob: Record<string, string>, touched?: AvailTouch[]): Promise<void> {
  try {
    const { after } = await import("next/server");
    try { after(async () => { const r = await pushPoolAvailability(blob, touched); console.log("[pool push]", JSON.stringify(r)); }); return; } catch { /* fuori da una richiesta: si attende qui */ }
    const r = await pushPoolAvailability(blob, touched); console.log("[pool push]", JSON.stringify(r));
  } catch { /* mai bloccare il chiamante */ }
}
