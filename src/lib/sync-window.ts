// FASE 2 · finestra di lettura. Il server tiene SEMPRE l'archivio completo (lo leggono molte funzioni); il browser di un utente con la sincronizzazione «a delta»
// scarica solo una FINESTRA: le prenotazioni recenti e future, gli ospiti che le riguardano e tutto il resto invariato (strutture, camere, tipologie,
// prezzi, impostazioni…). Qui la parte pura: dato il blocco dati (spigolestay:data:v1) restituisce la versione a finestra.
//
// Regole:
//  - prenotazione in finestra: parte da oggi in poi (checkOut >= inizio finestra), oppure arrivo futuro, oppure dati incompleti (senza date: si tiene);
//  - se UNA camera di una prenotazione di gruppo è in finestra, restano tutte (i totali di gruppo non si spezzano);
//  - ospite in finestra: citato da una prenotazione in finestra, oppure creato/modificato negli ultimissimi giorni (appena inserito, non ancora prenotato);
//  - tutto il resto del blocco (strutture, camere, tipologie, eventi, recensioni, prezzi, lapidi, attività…) passa INTERO.

export const WINDOW_PAST_DAYS = 400;      // il cruscotto confronta con l'anno scorso: 13 mesi indietro bastano
const FRESH_GUEST_DAYS = 3;                // ospiti nuovi, non ancora prenotati

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const str = (x: unknown): string => (typeof x === "string" ? x : "");

const DAY_MS = 86400000;
const isoOfMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Primo giorno della finestra (yyyy-mm-dd), `pastDays` giorni prima di `today`. */
export function windowFrom(today: string, pastDays: number = WINDOW_PAST_DAYS): string {
  const t = Date.parse(today + "T00:00:00Z");
  return isoOfMs((Number.isFinite(t) ? t : Date.now()) - Math.max(0, pastDays) * DAY_MS);
}

export interface WindowStats { bookingsTotal: number; bookingsKept: number; guestsTotal: number; guestsKept: number }

/** Una prenotazione è «in finestra»? (senza raggruppamento: quello si applica dopo, su tutto l'elenco). */
export function bookingInWindow(b: Json, from: string, today: string): boolean {
  const out = str(b.checkOut), inn = str(b.checkIn);
  if (!out && !inn) return true;          // dati incompleti: si tiene
  if (out && out >= from) return true;    // finita dopo l'inizio della finestra (in corso, futura o recente)
  if (inn && inn >= today) return true;   // arrivo futuro
  return false;
}

/** Applica la finestra al contenuto di `spigolestay:data:v1` (oggetto già letto). Ritorna una copia; l'originale non cambia. */
export function windowDataObject(data: Json, today: string, pastDays: number = WINDOW_PAST_DAYS): { data: Json; stats: WindowStats } {
  const from = windowFrom(today, pastDays);
  const bookings = arr(data.bookings);
  const guests = arr(data.guests);

  const keep = new Set<Json>();
  const groups = new Set<string>();
  for (const b of bookings) if (bookingInWindow(b, from, today)) { keep.add(b); const g = str(b.groupId); if (g) groups.add(g); }
  for (const b of bookings) if (!keep.has(b)) { const g = str(b.groupId); if (g && groups.has(g)) keep.add(b); }
  const winBookings = bookings.filter((b) => keep.has(b));

  const guestIds = new Set<string>();
  for (const b of winBookings) { const g = str(b.guestId); if (g) guestIds.add(g); }
  const freshFrom = Date.parse(today + "T00:00:00Z") - FRESH_GUEST_DAYS * DAY_MS;
  const winGuests = guests.filter((g) => {
    const id = str(g.id);
    if (id && guestIds.has(id)) return true;
    const ts = typeof g.updatedAt === "number" ? g.updatedAt : 0;
    return ts >= freshFrom;
  });

  return {
    data: { ...data, bookings: winBookings, guests: winGuests },
    stats: { bookingsTotal: bookings.length, bookingsKept: winBookings.length, guestsTotal: guests.length, guestsKept: winGuests.length },
  };
}

const DATA_KEY = "spigolestay:data:v1";

/** Applica la finestra a una riga di stato (app_state / org_state): solo la chiave dei dati cambia, tutte le altre restano intere. */
export function windowRowData(row: Record<string, string> | null, today: string, pastDays: number = WINDOW_PAST_DAYS): { data: Record<string, string> | null; stats: WindowStats | null } {
  if (!row) return { data: row, stats: null };
  const raw = row[DATA_KEY];
  if (!raw) return { data: row, stats: null };
  let parsed: Json;
  try { parsed = JSON.parse(raw) as Json; } catch { return { data: row, stats: null }; } // illeggibile: si lascia com'è (mai nascondere dati)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { data: row, stats: null };
  const w = windowDataObject(parsed, today, pastDays);
  return { data: { ...row, [DATA_KEY]: JSON.stringify(w.data) }, stats: w.stats };
}
