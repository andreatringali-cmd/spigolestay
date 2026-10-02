// Revenue — confronto con lo stesso periodo dell'anno scorso e commissioni reali per canale.
//
// Tutto calcolato dalle prenotazioni reali nello store, mai stimato. Il "stesso periodo" è
// spostato di 52 settimane (364 giorni) così i giorni della settimana coincidono (un sabato si
// confronta con un sabato). Limiti dichiarati: si assume che il numero di camere vendibili sia
// quello di oggi, e il "ritmo a questa data" richiede la data di prenotazione (bookedOn).
// Logica pura, testabile.
import type { Booking, Channel, Unit } from "./types";

const DAY = 86_400_000;
const toUTC = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const shift = (iso: string, n: number) => new Date(toUTC(iso) + n * DAY).toISOString().slice(0, 10);
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((toUTC(b) - toUTC(a)) / DAY));

export const YOY_SHIFT_DAYS = 364;
// Sotto questa quota di prenotazioni con data di prenotazione, il "ritmo a questa data" non è affidabile.
export const PACE_MIN_BOOKEDON_SHARE = 0.8;

const counts = (b: Booking) => b.status !== "cancelled" && b.channel !== "blocked";

export interface WindowStats {
  roomNights: number; capacity: number; occ: number; adr: number; revenue: number; bookings: number;
}

function windowStats(bookings: Booking[], roomCount: number, from: string, days: number, opts: { bookedBy?: string } = {}): WindowStats {
  let sold = 0, rev = 0; const ids = new Set<string>();
  for (let i = 0; i < days; i++) {
    const D = shift(from, i);
    for (const b of bookings) {
      if (!counts(b) || !(b.checkIn <= D && D < b.checkOut)) continue;
      if (opts.bookedBy && !(b.bookedOn && b.bookedOn.slice(0, 10) <= opts.bookedBy)) continue;
      sold++; rev += (b.total || 0) / nightsBetween(b.checkIn, b.checkOut); ids.add(b.id);
    }
  }
  const capacity = roomCount * days;
  return { roomNights: sold, capacity, occ: capacity ? sold / capacity : 0, adr: sold ? rev / sold : 0, revenue: rev, bookings: ids.size };
}

export interface YoyResult {
  now: WindowStats;               // finestra [from, from+days) già a libro oggi
  lastYear: WindowStats;          // stesso periodo (−52 settimane) a consuntivo
  lastYearAtSameDate: WindowStats | null; // com'era l'anno scorso alla stessa data di oggi (null se dati insufficienti)
  hasHistory: boolean;            // c'è almeno una prenotazione l'anno scorso in quel periodo
  paceReliable: boolean;
  deltaOccPts: number | null;     // punti % di occupazione: ora − anno scorso a consuntivo
  deltaPaceOccPts: number | null; // punti %: ora − anno scorso alla stessa data (confronto alla pari)
  deltaAdrPct: number | null;
}

export function yoyCompare(bookings: Booking[], units: Unit[], structureId: string, fromISO: string, days: number, todayISO: string): YoyResult {
  const sUnits = units.filter((u) => !u.outOfService && (structureId === "all" || u.structureId === structureId));
  const sBooks = bookings.filter((b) => structureId === "all" || b.structureId === structureId);
  const rooms = sUnits.length;
  const lyFrom = shift(fromISO, -YOY_SHIFT_DAYS);
  const now = windowStats(sBooks, rooms, fromISO, days);
  const lastYear = windowStats(sBooks, rooms, lyFrom, days);
  const hasHistory = lastYear.roomNights > 0;
  const lyBooks = sBooks.filter((b) => counts(b) && b.checkIn < shift(lyFrom, days) && b.checkOut > lyFrom);
  const withBookedOn = lyBooks.filter((b) => !!b.bookedOn).length;
  const paceReliable = hasHistory && lyBooks.length > 0 && withBookedOn / lyBooks.length >= PACE_MIN_BOOKEDON_SHARE;
  const lastYearAtSameDate = paceReliable ? windowStats(sBooks, rooms, lyFrom, days, { bookedBy: shift(todayISO, -YOY_SHIFT_DAYS) }) : null;
  return {
    now, lastYear, lastYearAtSameDate, hasHistory, paceReliable,
    deltaOccPts: hasHistory && rooms ? Math.round((now.occ - lastYear.occ) * 100) : null,
    deltaPaceOccPts: lastYearAtSameDate && rooms ? Math.round((now.occ - lastYearAtSameDate.occ) * 100) : null,
    deltaAdrPct: hasHistory && lastYear.adr > 0 && now.adr > 0 ? Math.round(((now.adr - lastYear.adr) / lastYear.adr) * 100) : null,
  };
}

/** Occupazione a consuntivo dell'anno scorso per UN giorno (stesso giorno della settimana), per le righe di tabella. */
export function lastYearDayOcc(bookings: Booking[], units: Unit[], structureId: string, iso: string): number | null {
  const rooms = units.filter((u) => !u.outOfService && (structureId === "all" || u.structureId === structureId)).length;
  if (!rooms) return null;
  const D = shift(iso, -YOY_SHIFT_DAYS);
  const sBooks = bookings.filter((b) => (structureId === "all" || b.structureId === structureId) && counts(b));
  if (!sBooks.some((b) => b.checkIn <= D && D < b.checkOut) && !sBooks.some((b) => b.checkOut <= D)) return null; // nessuno storico prima di quella data
  const sold = sBooks.filter((b) => b.checkIn <= D && D < b.checkOut).length;
  return Math.min(1, sold / rooms);
}

export interface ChannelCommission { pct: number; n: number }

/**
 * Commissione media REALE di un canale: totale commissioni / totale soggiorni delle prenotazioni che
 * hanno l'importo (commissionAmount) o la percentuale (commissionPct) registrati. null = nessun dato.
 */
export function realChannelCommission(bookings: Booking[], channel: Channel, structureId: string, sinceISO: string): ChannelCommission | null {
  let comm = 0, tot = 0, n = 0;
  for (const b of bookings) {
    if (b.channel !== channel || b.status === "cancelled") continue;
    if (structureId !== "all" && b.structureId !== structureId) continue;
    if (b.checkIn < sinceISO) continue;
    const total = b.total ?? 0;
    if (total <= 0) continue;
    const amount = typeof b.commissionAmount === "number" ? b.commissionAmount : typeof b.commissionPct === "number" ? total * b.commissionPct / 100 : null;
    if (amount == null) continue;
    comm += amount; tot += total; n++;
  }
  return n && tot > 0 ? { pct: comm / tot, n } : null;
}
