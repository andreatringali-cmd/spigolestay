// Ospiti in arrivo con un contatto da correggere: serve ad avvisare IN TEMPO, quando c'è ancora modo di correggere il numero o l'email,
// chiedere il contatto all'ospite (anche dalla chat dell'OTA) o trovare un'alternativa. Funzione pura: il controllo del singolo contatto
// (contactReportCached) si passa da fuori, così il modulo resta collaudabile con Node.
import type { ContactReport } from "./contacts-check";

export interface UpBooking { id: string; guestId: string; checkIn: string; checkOut: string; status: string; channel: string; structureId: string }
export interface UpGuest { id: string; fullName: string; phone?: string; email?: string; country?: string }
export interface UpcomingIssue { guest: UpGuest; booking: UpBooking; days: number; report: ContactReport; urgent: boolean }

/** Quanti giorni prima dell'arrivo il problema diventa urgente (rosso). */
export const URGENT_DAYS = 10;
const daysBetween = (iso: string, today: string) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);

export function upcomingContactIssues(
  bookings: UpBooking[], guests: UpGuest[], today: string,
  reportOf: (g: UpGuest) => ContactReport, horizonDays = 60,
): UpcomingIssue[] {
  const byId = new Map(guests.map((g) => [g.id, g]));
  const next = new Map<string, UpBooking>(); // per ospite: la prima prenotazione in arrivo (o che arriva oggi)
  for (const b of bookings) {
    if (b.channel === "blocked" || b.status === "cancelled" || b.status === "no_show") continue;
    if (b.checkIn < today || daysBetween(b.checkIn, today) > horizonDays) continue;
    const cur = next.get(b.guestId);
    if (!cur || b.checkIn < cur.checkIn) next.set(b.guestId, b);
  }
  const out: UpcomingIssue[] = [];
  for (const [gid, booking] of next) {
    const guest = byId.get(gid); if (!guest) continue;
    const report = reportOf(guest);
    if (!report.issues.length) continue;
    const days = daysBetween(booking.checkIn, today);
    out.push({ guest, booking, days, report, urgent: days <= URGENT_DAYS });
  }
  return out.sort((a, b) => a.days - b.days || a.guest.fullName.localeCompare(b.guest.fullName));
}
