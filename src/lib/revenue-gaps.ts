// Revenue — buchi ("notti orfane") tra prenotazioni sulla stessa camera e prenotazioni senza camera.
//
// Una notte orfana è un vuoto di 1-2 notti tra due prenotazioni della stessa unità: difficile da
// vendere (soprattutto se la tipologia ha un minimo di notti più alto del buco). Calcolata SOLO
// dalle prenotazioni reali nello store. Logica pura, testabile.
import type { Booking, RoomType, Unit } from "./types";

const DAY = 86_400_000;
const toUTC = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const nightsBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / DAY);

export const ORPHAN_MAX_NIGHTS = 2;

export interface OrphanGap {
  unitId: string; unitName: string;
  typeId: string; typeName: string; structureId: string;
  from: string;          // primo giorno libero (= check-out della prenotazione prima)
  to: string;            // check-in della prenotazione dopo (giorno NON libero)
  nights: number;
  minStay: number;       // notti minime della tipologia (0 = nessuna)
  unsellable: boolean;   // il buco è più corto del minimo notti: oggi non vendibile così com'è
  value: number;         // € a tariffa corrente se si vendesse il buco (0 se tariffa non nota)
}

export interface GapScan {
  gaps: OrphanGap[];
  unassigned: Booking[]; // prenotazioni attive nel periodo senza camera assegnata
}

export function scanGaps(opts: {
  bookings: Booking[]; units: Unit[]; roomTypes: RoomType[];
  fromISO: string; days: number; structureId: string; // "all" = tutte
  rateOf?: (typeId: string, iso: string) => number;
  minStayOf?: (rt: RoomType) => number;
}): GapScan {
  const { bookings, units, roomTypes, fromISO, structureId } = opts;
  const toISOEnd = new Date(toUTC(fromISO) + opts.days * DAY).toISOString().slice(0, 10);
  const inStruct = (sid: string) => structureId === "all" || sid === structureId;
  const live = bookings.filter((b) => b.status !== "cancelled" && inStruct(b.structureId));
  const gaps: OrphanGap[] = [];
  for (const u of units) {
    if (u.outOfService || !inStruct(u.structureId)) continue;
    const rt = roomTypes.find((r) => r.id === u.roomTypeId);
    const mine = live.filter((b) => b.unitId === u.id).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    for (let i = 0; i + 1 < mine.length; i++) {
      const a = mine[i], b = mine[i + 1];
      const n = nightsBetween(a.checkOut, b.checkIn);
      if (n < 1 || n > ORPHAN_MAX_NIGHTS) continue;
      if (a.checkOut < fromISO || a.checkOut >= toISOEnd) continue; // solo buchi che iniziano nell'orizzonte
      const minStay = rt ? (opts.minStayOf ? opts.minStayOf(rt) : rt.minStay ?? 0) : 0;
      let value = 0;
      if (opts.rateOf && rt) for (let k = 0; k < n; k++) value += opts.rateOf(rt.id, new Date(toUTC(a.checkOut) + k * DAY).toISOString().slice(0, 10));
      gaps.push({ unitId: u.id, unitName: u.name, typeId: u.roomTypeId, typeName: rt?.name ?? "", structureId: u.structureId, from: a.checkOut, to: b.checkIn, nights: n, minStay, unsellable: minStay > n, value });
    }
  }
  gaps.sort((x, y) => x.from.localeCompare(y.from));
  const unassigned = live.filter((b) => !b.unitId && b.channel !== "blocked" && b.checkOut > fromISO && b.checkIn < toISOEnd);
  return { gaps, unassigned };
}
