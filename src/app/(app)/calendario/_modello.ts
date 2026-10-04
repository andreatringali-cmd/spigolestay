// Logica pura della vista Calendario · Dettagliato: contatori per giorno, turnover, camere libere, blocchi.
// Nessuna scrittura e nessuna dipendenza da React: tutto parte da prenotazioni e camere già filtrate per struttura.
import type { Booking, Structure, Unit } from "@/lib/types";
import { shiftISO } from "@/lib/dates";

// Occupa la camera: tutto tranne annullate e no-show (compresi i blocchi / fuori servizio a date).
export const occupies = (b: Booking) => b.status !== "cancelled" && b.status !== "no_show";
export const isBlock = (b: Booking) => b.channel === "blocked";
// La prenotazione dorme nella notte che inizia il giorno d.
export const nightOf = (b: Booking, d: string) => b.checkIn <= d && d < b.checkOut;

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  for (let i = 0; i < 400 && d <= to; i++) { out.push(d); d = shiftISO(d, 1); }
  return out;
}

export interface DayStats { arrivals: number; departures: number; stay: number; free: number; totalUnits: number; clean: number; cleanDone: number; closed: number /* camere chiuse: fuori servizio + bloccate quella notte */ }

// `live`: prenotazioni vere (no blocchi/annullate/no-show) in scope. `busy`: tutte quelle che occupano, blocchi inclusi.
// `activeUnits`: camere in servizio in scope.
export function dayStats(day: string, live: Booking[], busy: Booking[], activeUnits: Unit[], cleanDone: Record<string, boolean>, outOfServiceCount = 0): DayStats {
  const occ = new Set<string>();
  for (const b of busy) if (b.unitId && nightOf(b, day)) occ.add(b.unitId);
  const unassigned = live.filter((b) => !b.unitId && nightOf(b, day)).length;
  const busyUnits = activeUnits.filter((u) => occ.has(u.id)).length;
  // Pulizia: come nel calendario a griglia (e nella pagina Pulizie) serve per arrivo, partenza o soggiorno in corso.
  const cleanUnits = new Set<string>();
  const active = new Set(activeUnits.map((u) => u.id));
  for (const b of live) if (b.unitId && active.has(b.unitId) && b.checkIn <= day && day <= b.checkOut) cleanUnits.add(b.unitId);
  // Camere chiuse nella notte: quelle fuori servizio (sempre) più quelle in servizio con un blocco a date.
  const blockedUnits = new Set<string>();
  for (const b of busy) if (isBlock(b) && b.unitId && active.has(b.unitId) && nightOf(b, day)) blockedUnits.add(b.unitId);
  return {
    closed: outOfServiceCount + blockedUnits.size,
    arrivals: live.filter((b) => b.checkIn === day).length,
    departures: live.filter((b) => b.checkOut === day).length,
    stay: live.filter((b) => b.checkIn < day && day < b.checkOut).length,
    free: Math.max(0, activeUnits.length - busyUnits - unassigned),
    totalUnits: activeUnits.length,
    clean: cleanUnits.size,
    cleanDone: [...cleanUnits].filter((id) => cleanDone[`${id}:${day}`]).length,
  };
}

// ── Turnover: una partenza e un arrivo lo stesso giorno sulla stessa camera ──
export interface Turnover { day: string; dep: Booking; arr: Booking }

export function turnoverIndex(live: Booking[]): { arr: Map<string, Turnover>; dep: Map<string, Turnover> } {
  const arrBy = new Map<string, Booking[]>();
  for (const b of live) if (b.unitId) { const k = `${b.unitId}|${b.checkIn}`; (arrBy.get(k) ?? arrBy.set(k, []).get(k)!).push(b); }
  const arr = new Map<string, Turnover>(), dep = new Map<string, Turnover>();
  for (const d of live) {
    if (!d.unitId) continue;
    for (const a of arrBy.get(`${d.unitId}|${d.checkOut}`) ?? []) {
      if (a.id === d.id) continue;
      const t = { day: d.checkOut, dep: d, arr: a };
      arr.set(a.id, t); dep.set(d.id, t);
    }
  }
  return { arr, dep };
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const validTime = (s?: string) => { const m = s && TIME_RE.exec(s.trim()); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined; };

// Etichetta del turnover: entro quando va pulita la camera. Usa SOLO gli orari davvero impostati
// (check-in dalle… della struttura, eventuale orario di arrivo comunicato dall'ospite, check-out entro…).
export function turnoverLabel(t: Turnover, getStructure: (id: string) => Structure | undefined): { label: string; title: string } {
  const st = getStructure(t.arr.structureId);
  const outBy = validTime(getStructure(t.dep.structureId)?.checkOutBy);
  let by = validTime(st?.checkInFrom);
  const eta = validTime(t.arr.arrivalTime);
  if (eta && (!by || eta < by)) by = eta;
  const parts = [outBy ? `La camera si libera dopo le ${outBy} (check-out)` : "", by ? `Il prossimo ospite arriva dalle ${by}${eta && eta === by ? " (orario comunicato)" : " (check-in)"}` : "", "Partenza e arrivo sulla stessa camera nello stesso giorno"].filter(Boolean);
  return { label: by ? `Turnover: pulizia entro le ${by}` : "Turnover: pulizia in giornata", title: parts.join(" · ") };
}

// ── Camere libere ──
export interface FreeUnit { unit: Unit; freeNights: number; totalNights: number; firstFree: string; next?: Booking; departing?: Booking }

export function freeUnits(activeUnits: Unit[], busy: Booking[], from: string, to: string): FreeUnit[] {
  const nights = daysBetween(from, to);
  const out: FreeUnit[] = [];
  for (const u of activeUnits) {
    const ub = busy.filter((b) => b.unitId === u.id);
    const free = nights.filter((n) => !ub.some((b) => nightOf(b, n)));
    if (!free.length) continue;
    const firstFree = free[0];
    out.push({
      unit: u, freeNights: free.length, totalNights: nights.length, firstFree,
      next: ub.filter((b) => b.checkIn > firstFree).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0],
      departing: ub.find((b) => !isBlock(b) && b.checkOut === firstFree),
    });
  }
  return out;
}

// Blocchi / fuori servizio a date che toccano il periodo.
export const blocksIn = (busy: Booking[], units: Unit[], from: string, to: string) => {
  const ids = new Set(units.map((u) => u.id));
  return busy.filter((b) => isBlock(b) && b.unitId && ids.has(b.unitId) && b.checkIn <= to && b.checkOut > from).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
};
