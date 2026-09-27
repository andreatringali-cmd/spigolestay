import { effectiveBase, effectiveMinStay, effectiveClosed } from "@/lib/pricing";
import { addDays, isWeekend, toISO } from "@/lib/dates";
import type { RoomType, Unit, Booking } from "@/lib/types";
import type { RestrictionRow } from "@/lib/channex";

// Mappatura di UNA struttura Xenora verso Channex (dal localStorage "spigolestay:channexmap").
export interface ChxStructMap {
  propertyId: string;
  rooms?: Record<string, { roomTypeId: string; ratePlanId?: string }>; // xenora room_type id → channex ids
  at?: string;
}

export interface AvailRow { property_id: string; room_type_id: string; date: string; availability: number }

// Calcola disponibilità, prezzi e restrizioni dei prossimi giorni per una struttura, pronti
// per /api/channex/ari.
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
  opts?: { days?: number; weekendPct?: number; closes?: Record<string, number> },
): { availability: AvailRow[]; restrictions: RestrictionRow[] } {
  const availability: AvailRow[] = [];
  const restrictions: RestrictionRow[] = [];
  if (!map.rooms) return { availability, restrictions };
  const rts = roomTypes.filter((rt) => rt.structureId === structureId && map.rooms![rt.id]);
  if (rts.length === 0) return { availability, restrictions };
  const DAYS = opts?.days ?? 60;
  const weekendPct = opts?.weekendPct ?? 25;
  // Chiusure vendita manuali per (tipologia|giorno): quante camere chiudere alla vendita per quel
  // giorno (può essere negativo = overbooking volontario, più camere offerte del reale). Stessa
  // chiave del calendario ("spigolestay:calcloses"): `${roomTypeId}|${iso}`.
  const closes = opts?.closes ?? {};
  const base0 = new Date();
  for (const rt of rts) {
    const mp = map.rooms![rt.id];
    const totalUnits = units.filter((u) => u.roomTypeId === rt.id && !u.outOfService).length;
    // Restrizioni a livello tipologia (indipendenti dal giorno): min stay effettivo e chiusura
    // vendite dell'intera tipologia (entrambi risolvono l'eventuale ereditarietà dalla madre).
    const minStay = effectiveMinStay(rt, roomTypes);   // notti minime della tipologia (0 = nessuna)
    const typeClosed = effectiveClosed(rt, roomTypes); // vendite chiuse per tutta la tipologia
    for (let d = 0; d < DAYS; d++) {
      const dt = addDays(base0, d);
      const iso = toISO(dt);
      // Occupato = QUALSIASI prenotazione non annullata che copre il giorno, incluso il "blocked"
      // (fuori servizio a periodo). Il fuori servizio permanente è già escluso da totalUnits.
      const occupied = bookings.filter((b) => b.status !== "cancelled" && b.roomTypeId === rt.id && b.checkIn <= iso && iso < b.checkOut).length;
      const closed = closes[`${rt.id}|${iso}`] ?? 0; // camere chiuse alla vendita per quel giorno
      availability.push({ property_id: map.propertyId, room_type_id: mp.roomTypeId, date: iso, availability: Math.max(0, totalUnits - occupied - closed) });
      if (mp.ratePlanId) {
        const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(effectiveBase(rt, roomTypes) * (isWeekend(dt) ? 1 + weekendPct / 100 : 1));
        const row: RestrictionRow = {
          property_id: map.propertyId,
          rate_plan_id: mp.ratePlanId,
          date: iso,
          rate: Math.max(0, raw).toFixed(2),
        };
        // min_stay_arrival: soggiorno minimo all'arrivo. Inviato solo se > 1 (1 o 0 = nessun vincolo,
        // inutile spedirlo e rischiare di sovrascrivere impostazioni del canale).
        if (minStay > 1) row.min_stay_arrival = minStay;
        // stop_sell: giorno completamente chiuso alla vendita → vendite tipologia chiuse OPPURE
        // camere chiuse a mano ≥ camere totali della tipologia (nessuna camera realmente vendibile).
        // Il guardia totalUnits > 0 evita di marcare stop_sell per il caso degenere 0 ≥ 0.
        if (typeClosed || (totalUnits > 0 && closed >= totalUnits)) row.stop_sell = true;
        // max_stay / closed_to_arrival / closed_to_departure: NON inviati — Xenora non ha ancora
        // un dato reale per queste restrizioni, quindi non li inventiamo.
        restrictions.push(row);
      }
    }
  }
  return { availability, restrictions };
}
