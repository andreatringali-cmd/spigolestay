import { effectiveBase } from "@/lib/pricing";
import { addDays, isWeekend, toISO } from "@/lib/dates";
import type { RoomType, Unit, Booking } from "@/lib/types";

// Mappatura di UNA struttura Xenora verso Channex (dal localStorage "spigolestay:channexmap").
export interface ChxStructMap {
  propertyId: string;
  rooms?: Record<string, { roomTypeId: string; ratePlanId?: string }>; // xenora room_type id → channex ids
  at?: string;
}

export interface AvailRow { property_id: string; room_type_id: string; date: string; availability: number }
export interface RateRow { property_id: string; rate_plan_id: string; date: string; rate: string }

// Calcola disponibilità e prezzi dei prossimi giorni per una struttura, pronti per /api/channex/ari.
// Disponibilità = camere della tipologia NON fuori servizio (unit.outOfService) − prenotazioni che
// occupano quel giorno. CONTA come occupato anche il "fuori servizio a periodo" (channel "blocked"):
// una camera bloccata per manutenzione NON è vendibile, quindi deve ridurre la disponibilità inviata
// alle OTA (altrimenti si rischia overbooking su una camera indisponibile).
export function buildAriPayload(
  map: ChxStructMap,
  structureId: string,
  roomTypes: RoomType[],
  units: Unit[],
  bookings: Booking[],
  rateOverrides: Record<string, number>,
  opts?: { days?: number; weekendPct?: number },
): { availability: AvailRow[]; rates: RateRow[] } {
  const availability: AvailRow[] = [];
  const rates: RateRow[] = [];
  if (!map.rooms) return { availability, rates };
  const rts = roomTypes.filter((rt) => rt.structureId === structureId && map.rooms![rt.id]);
  if (rts.length === 0) return { availability, rates };
  const DAYS = opts?.days ?? 60;
  const weekendPct = opts?.weekendPct ?? 25;
  const base0 = new Date();
  for (const rt of rts) {
    const mp = map.rooms![rt.id];
    const totalUnits = units.filter((u) => u.roomTypeId === rt.id && !u.outOfService).length;
    for (let d = 0; d < DAYS; d++) {
      const dt = addDays(base0, d);
      const iso = toISO(dt);
      // Occupato = QUALSIASI prenotazione non annullata che copre il giorno, incluso il "blocked"
      // (fuori servizio a periodo). Il fuori servizio permanente è già escluso da totalUnits.
      const occupied = bookings.filter((b) => b.status !== "cancelled" && b.roomTypeId === rt.id && b.checkIn <= iso && iso < b.checkOut).length;
      availability.push({ property_id: map.propertyId, room_type_id: mp.roomTypeId, date: iso, availability: Math.max(0, totalUnits - occupied) });
      if (mp.ratePlanId) {
        const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(effectiveBase(rt, roomTypes) * (isWeekend(dt) ? 1 + weekendPct / 100 : 1));
        rates.push({ property_id: map.propertyId, rate_plan_id: mp.ratePlanId, date: iso, rate: Math.max(0, raw).toFixed(2) });
      }
    }
  }
  return { availability, rates };
}
