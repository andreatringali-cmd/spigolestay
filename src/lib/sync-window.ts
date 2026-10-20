// FASE 2 · finestra di lettura. Il server tiene SEMPRE l'archivio completo (lo leggono molte funzioni); il browser di un utente con la sincronizzazione «a delta»
// scarica solo una FINESTRA: le prenotazioni recenti e future, gli ospiti che le riguardano e tutto il resto invariato (strutture, camere, tipologie,
// prezzi, impostazioni…). Qui la parte pura: dato il blocco dati (spigolestay:data:v1) restituisce la versione a finestra.
//
// Regole (la finestra per STRUTTURA, parametro structureIds, è descritta più sotto):
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

export interface WindowStats { bookingsTotal: number; bookingsKept: number; guestsTotal: number; guestsKept: number; structuresFiltered?: boolean }

// ── FILTRO PER STRUTTURA (apertura veloce: UNA struttura sola) ────────────────────────────────────────────────────────────────────────────────────────────
// `structureIds` = elenco delle strutture di cui il browser vuole prenotazioni/ospiti/eventi/recensioni/prezzi forzati. Strutture, tipologie e camere di TUTTE le
// strutture passano sempre (servono al selettore e ai conteggi, sono piccole). Regole prudenti: nel dubbio si CARICA DI PIÙ, mai di meno:
//  - null/undefined = nessun filtro (comportamento di prima);  [] = nessuna struttura (solo il «guscio»: strutture, camere, impostazioni);
//  - si scarta SOLO ciò che appartiene a una struttura che questa riga conosce e che non è tra quelle richieste; senza struttura, o di una struttura sconosciuta
//    a questa riga (es. copie vecchie), si tiene;
//  - gli id richiesti che questa riga non conosce sono ignorati (la riga personale e quelle delle organizzazioni hanno strutture diverse).
/** Legge il parametro `structureIds` della richiesta: assente = nessun filtro; «none» = nessuna struttura; altrimenti elenco separato da virgole (max 50, solo caratteri di un id). */
export function parseStructureIds(param: string | null | undefined): string[] | null {
  if (param === null || param === undefined) return null;
  const p = param.trim();
  if (p === "") return null;                 // vuoto = nessun filtro (mai «niente» per un parametro mal scritto)
  if (p === "none") return [];
  const ids = p.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,80}$/.test(x)).slice(0, 50);
  return ids.length ? ids : null;            // illeggibile = nessun filtro
}
const sidOf = (x: Json): string => str(x.structureId);

/** Massimo progressivo dei codici prenotazione «XEN-AAAA-nnnn» per anno, su TUTTE le prenotazioni della riga (anche fuori finestra/struttura): serve a non ripetere un codice. */
export function codeMaxOf(bookings: Json[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bookings) {
    const m = /^XEN-(\d{4})-(\d+)$/.exec(str(b.code));
    if (m) { const n = Number(m[2]); if (n > (out[m[1]] ?? 0)) out[m[1]] = n; }
  }
  return out;
}

/** Una prenotazione è «in finestra»? (senza raggruppamento: quello si applica dopo, su tutto l'elenco). */
export function bookingInWindow(b: Json, from: string, today: string): boolean {
  const out = str(b.checkOut), inn = str(b.checkIn);
  if (!out && !inn) return true;          // dati incompleti: si tiene
  if (out && out >= from) return true;    // finita dopo l'inizio della finestra (in corso, futura o recente)
  if (inn && inn >= today) return true;   // arrivo futuro
  return false;
}

/** Applica la finestra al contenuto di `spigolestay:data:v1` (oggetto già letto). Ritorna una copia; l'originale non cambia. */
export function windowDataObject(data: Json, today: string, pastDays: number = WINDOW_PAST_DAYS, structureIds?: string[] | null): { data: Json; stats: WindowStats } {
  const from = windowFrom(today, pastDays);
  const allBookings = arr(data.bookings);
  const guests = arr(data.guests);

  // Filtro per struttura (vedi sopra). `rowSids` = strutture che QUESTA riga conosce.
  const filtered = Array.isArray(structureIds);
  const want = new Set<string>(filtered ? structureIds : []);
  const rowSids = new Set<string>(arr(data.structures).map((s) => str(s.id)).filter(Boolean));
  const wanted = (sid: string): boolean => !filtered || !sid || !rowSids.has(sid) || want.has(sid);
  const bookings = filtered ? allBookings.filter((b) => wanted(sidOf(b))) : allBookings;

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

  const out: Json = { ...data, bookings: winBookings, guests: winGuests };
  if (filtered) {
    // Eventi e recensioni dirette: solo quelli delle strutture richieste (o senza struttura / di struttura sconosciuta).
    if (Array.isArray(data.events)) out.events = arr(data.events).filter((e) => wanted(sidOf(e)));
    if (Array.isArray(data.directReviews)) out.directReviews = arr(data.directReviews).filter((r) => wanted(sidOf(r)));
    // Prezzi forzati: chiave «tipologiaId|AAAA-MM-GG» → si tengono quelli delle tipologie delle strutture richieste; chiavi senza «|» o di tipologia sconosciuta restano.
    const ro = data.rateOverrides;
    if (ro && typeof ro === "object" && !Array.isArray(ro)) {
      const sidOfRt = new Map<string, string>();
      for (const rt of arr(data.roomTypes)) { const id = str(rt.id), sid = sidOf(rt); if (id && sid) sidOfRt.set(id, sid); }
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(ro as Record<string, unknown>)) {
        const rtId = k.includes("|") ? k.split("|")[0] : "";
        const sid = rtId ? sidOfRt.get(rtId) ?? "" : "";
        if (wanted(sid)) next[k] = v;
      }
      out.rateOverrides = next;
    }
  }
  return {
    data: out,
    stats: { bookingsTotal: allBookings.length, bookingsKept: winBookings.length, guestsTotal: guests.length, guestsKept: winGuests.length, ...(filtered ? { structuresFiltered: true } : {}) },
  };
}

/**
 * Toglie dalla copia LOCALE (blocco dati intero, già fuso) le entità delle strutture NON richieste che sono certamente già sul server: stantie e inutili
 * (peserebbero nel browser e, nei lavori in sottofondo, sembrerebbero dati freschi). Cautela: si tiene tutto ciò che potrebbe NON essere ancora sincronizzato
 * (timbro `updatedAt` successivo a `syncedAt` meno un margine, oppure assente). Ospiti: via solo quelli citati ESCLUSIVAMENTE da prenotazioni tolte.
 * Ritorna una copia; l'originale non cambia. `structureIds` null = niente da togliere.
 */
export function pruneLocalToStructures(data: Json, structureIds: string[] | null, syncedAt: number, slackMs: number = 120000, pruneRates: boolean = false): Json {
  if (!Array.isArray(structureIds) || !(syncedAt > 0)) return data; // senza un «ultima sincronizzazione riuscita» non si toglie nulla
  const limit = syncedAt - slackMs;
  const want = new Set(structureIds);
  const rowSids = new Set<string>(arr(data.structures).map((s) => str(s.id)).filter(Boolean));
  const unwanted = (sid: string): boolean => !!sid && rowSids.has(sid) && !want.has(sid);
  const synced = (x: Json): boolean => typeof x.updatedAt === "number" && x.updatedAt <= limit; // timbro assente = potrebbe essere nuova: si tiene
  const bookings = arr(data.bookings);
  const gone = bookings.filter((b) => unwanted(sidOf(b)) && synced(b));
  const goneSet = new Set<Json>(gone);
  const keptBookings = bookings.filter((b) => !goneSet.has(b));
  const stillCited = new Set<string>();
  for (const b of keptBookings) { const g = str(b.guestId); if (g) stillCited.add(g); }
  const goneCited = new Set<string>();
  for (const b of gone) { const g = str(b.guestId); if (g) goneCited.add(g); }
  const next: Json = { ...data, bookings: keptBookings };
  next.guests = arr(data.guests).filter((g) => { const id = str(g.id); return !(id && goneCited.has(id) && !stillCited.has(id) && synced(g)); });
  if (Array.isArray(data.events)) next.events = arr(data.events).filter((e) => !(unwanted(sidOf(e)) && synced(e)));
  if (Array.isArray(data.directReviews)) next.directReviews = arr(data.directReviews).filter((r) => !(unwanted(sidOf(r)) && synced(r)));
  // Prezzi forzati: non hanno un timbro, quindi si tolgono SOLO se il chiamante garantisce che non sono cambiati dall'ultima sincronizzazione riuscita (pruneRates).
  const ro = data.rateOverrides;
  if (pruneRates && ro && typeof ro === "object" && !Array.isArray(ro)) {
    const sidOfRt = new Map<string, string>();
    for (const rt of arr(data.roomTypes)) { const id = str(rt.id), sid = sidOf(rt); if (id && sid) sidOfRt.set(id, sid); }
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ro as Record<string, unknown>)) {
      const rtId = k.includes("|") ? k.split("|")[0] : "";
      if (!unwanted(rtId ? sidOfRt.get(rtId) ?? "" : "")) kept[k] = v;
    }
    next.rateOverrides = kept;
  }
  return next;
}

const DATA_KEY = "spigolestay:data:v1";

/** Applica la finestra a una riga di stato (app_state / org_state): solo la chiave dei dati cambia, tutte le altre restano intere. */
export function windowRowData(row: Record<string, string> | null, today: string, pastDays: number = WINDOW_PAST_DAYS, structureIds?: string[] | null): { data: Record<string, string> | null; stats: WindowStats | null; codeMax: Record<string, number> } {
  if (!row) return { data: row, stats: null, codeMax: {} };
  const raw = row[DATA_KEY];
  if (!raw) return { data: row, stats: null, codeMax: {} };
  let parsed: Json;
  try { parsed = JSON.parse(raw) as Json; } catch { return { data: row, stats: null, codeMax: {} }; } // illeggibile: si lascia com'è (mai nascondere dati)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { data: row, stats: null, codeMax: {} };
  const w = windowDataObject(parsed, today, pastDays, structureIds);
  return { data: { ...row, [DATA_KEY]: JSON.stringify(w.data) }, stats: w.stats, codeMax: codeMaxOf(arr(parsed.bookings)) }; // codeMax sull'archivio COMPLETO della riga
}
