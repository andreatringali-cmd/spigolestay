// Logica PURA della scheda "Informazioni" del pannello prenotazione (stile pagina prenotazione di Channex):
// giorno della settimana, occupazione, fasce di cancellazione, dettaglio per notte, camere di un gruppo, nomi ospiti, note.
// Nessun accesso a rete/DB/browser: testabile con `node --test`. I calcoli economici NON stanno qui (vedi lib/booking.ts).
import { shiftISO } from "./dates";
import type { OtaCancelPenalty } from "./channex-guestdata";

const WD = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Giorno della settimana abbreviato in italiano ("ven") di una data ISO; "" se non valida. Calcolo in UTC: non dipende dal fuso del dispositivo. */
export function weekdayOfISO(iso?: string | null): string {
  const m = ISO_RE.exec(String(iso ?? ""));
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) return "";
  return WD[d.getUTCDay()];
}

/** "2026-10-30" → "ven 30.10.2026". Se non è una data ISO restituisce il testo com'è (o "" se vuoto). */
export function fmtDateWd(iso?: string | null): string {
  const s = String(iso ?? "");
  const m = ISO_RE.exec(s);
  if (!m) return s;
  const wd = weekdayOfISO(s);
  return `${wd ? wd + " " : ""}${m[3]}.${m[2]}.${m[1]}`;
}

/** Occupazione nel formato Channex: "A: 2 C: 0 I: 0" (adulti, bambini, neonati/culle). I neonati si mostrano solo se il dato è noto (cribs). */
export function occupancyLabel(b: { adults?: number; children?: number; cribs?: number }): string {
  const parts = [`A: ${Math.max(0, b.adults ?? 0)}`, `C: ${Math.max(0, b.children ?? 0)}`];
  if (typeof b.cribs === "number") parts.push(`I: ${Math.max(0, b.cribs)}`);
  return parts.join(" ");
}

/** Data (gg.mm.aaaa) e ora (HH:MM, se presente) da un "from" di penale: "2026-10-28 00:00:00", "2026-10-28T14:30:00+02:00" o solo "2026-10-28". */
export function splitFrom(from?: string | null): { date: string; time?: string } {
  const s = String(from ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return { date: s };
  return { date: `${m[3]}.${m[2]}.${m[1]}`, ...(m[4] !== undefined ? { time: `${m[4].padStart(2, "0")}:${m[5]}` } : {}) };
}

export interface CancelLine { from: string; amount: number; currency?: string; free: boolean }

/** Fasce di cancellazione "Da <data ora> → importo", ordinate per data (una riga per penale dell'OTA). */
export function cancelPenaltyLines(p?: OtaCancelPenalty[] | null): CancelLine[] {
  if (!Array.isArray(p)) return [];
  return [...p]
    .filter((x) => x && typeof x.from === "string" && Number.isFinite(x.amount))
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((x) => {
      const { date, time } = splitFrom(x.from);
      return { from: time ? `${date} ${time}` : date, amount: x.amount, ...(x.currency ? { currency: x.currency } : {}), free: x.amount === 0 };
    });
}

/** Testo della cancellazione per le prenotazioni DIRETTE (dal piano tariffario salvato sulla prenotazione). undefined = nessun dato. */
export function directCancelText(b: { refundable?: boolean; cancelDays?: number; checkIn: string; ratePlanName?: string }): string | undefined {
  if (b.refundable === false) return "Non rimborsabile: nessun rimborso in caso di cancellazione";
  if (b.refundable === true) {
    const d = b.cancelDays;
    if (typeof d === "number" && d >= 0) {
      const until = splitFrom(shiftISO(b.checkIn, -d)).date;
      return d === 0
        ? `Cancellazione gratuita fino al giorno del check-in (${until})`
        : `Cancellazione gratuita fino a ${d} ${d === 1 ? "giorno" : "giorni"} prima del check-in (entro il ${until})`;
    }
    return "Cancellazione gratuita";
  }
  return undefined;
}

export interface NightRow { date: string; label: string; amount: number }
export interface NightBreakdown { exact: boolean; rows: NightRow[]; subtotal: number }

/**
 * Dettaglio per notte (Price Breakdown). Solo se l'OTA ha mandato il prezzo notte per notte (nightlyRates): altrimenti `exact` è false e non si
 * inventa nessuna divisione (subtotale = totale del soggiorno). `amountOf` è la funzione dell'app (nightlyRevenue di lib/booking.ts), che completa
 * le notti senza tariffa: così le righe tornano col totale. Importi ai centesimi.
 */
export function nightRows(
  b: { checkIn: string; checkOut: string; total?: number; nightlyRates?: Record<string, number> },
  amountOf: (iso: string) => number,
): NightBreakdown {
  const total = b.total ?? 0;
  if (!b.nightlyRates || Object.keys(b.nightlyRates).length === 0) return { exact: false, rows: [], subtotal: total };
  const rows: NightRow[] = [];
  let cents = 0;
  for (let d = b.checkIn, i = 0; d < b.checkOut && i < 400; d = shiftISO(d, 1), i++) {
    const amount = Math.round((amountOf(d) || 0) * 100) / 100;
    cents += Math.round(amount * 100);
    rows.push({ date: d, label: fmtDateWd(d), amount });
  }
  return { exact: true, rows, subtotal: cents / 100 };
}

/** Camere della prenotazione: se è di un gruppo, tutte le righe con lo stesso groupId e la stessa struttura (annullate escluse, tranne quella aperta). */
export function groupRooms<T extends { id: string; groupId?: string; structureId: string; status?: string; channel?: string }>(b: T, all: T[]): T[] {
  if (!b.groupId) return [b];
  const rows = all.filter((x) => x.groupId === b.groupId && x.structureId === b.structureId && x.channel !== "blocked" && (x.id === b.id || x.status !== "cancelled"));
  return rows.some((x) => x.id === b.id) ? rows : [b, ...rows];
}

type PersonLike = { firstName?: string; lastName?: string };
const fullOf = (p?: PersonLike | null) => [p?.firstName, p?.lastName].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");

/** Nomi degli ospiti della camera: titolare (dati sulla prenotazione o anagrafica) + co-ospiti, senza doppioni. */
export function guestNames(
  b: { primaryGuest?: PersonLike; extraGuests?: PersonLike[] },
  guest?: { fullName?: string; firstName?: string; lastName?: string } | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (n: string) => { const k = n.trim().toLowerCase().replace(/\s+/g, " "); if (k && !seen.has(k)) { seen.add(k); out.push(n.trim()); } };
  add(fullOf(b.primaryGuest) || (guest?.fullName ?? "") || fullOf(guest));
  for (const g of b.extraGuests ?? []) add(fullOf(g));
  return out;
}

/** "Genius" solo se il dato ESISTE nei testi della prenotazione (note OTA, note, richieste); mai dedotto. Ritorna es. "Genius Booker" o "Genius Booker · livello 2". */
export function detectGenius(texts: (string | undefined | null)[]): string | undefined {
  for (const t of texts) {
    if (!t) continue;
    const m = /genius(?:\s*(?:level|livello|lvl)?\s*[:\-]?\s*([123])\b)?/i.exec(t);
    if (m) return m[1] ? `Genius Booker · livello ${m[1]}` : "Genius Booker";
  }
  return undefined;
}

// Nota di sistema generata dall'import ("Prenotazione BOOKING via Channex · 123456"): non è un appunto scritto da una persona.
const AUTO_NOTE = /^Prenotazione\s+\S+\s+via Channex(?:\s*·\s*\S+)?\s*$/i;

export interface NoteBlock { key: "ota" | "note" | "guest"; text: string }

/** Appunti da mostrare: richieste del cliente dall'OTA, note interne, richieste lasciate dall'ospite. Vuoti e doppioni (stesso testo) esclusi; testo intero, a capo conservati. */
export function notesBlocks(b: { note?: string; guestRequests?: string; otaInfo?: { notes?: string } | null }): NoteBlock[] {
  const out: NoteBlock[] = [];
  const clean = (s?: string | null) => (typeof s === "string" ? s.replace(/\s+$/g, "").replace(/^\s*\n+/, "") : "");
  const ota = clean(b.otaInfo?.notes);
  const note = clean(b.note);
  const guest = clean(b.guestRequests);
  if (ota.trim()) out.push({ key: "ota", text: ota });
  if (note.trim() && !AUTO_NOTE.test(note.trim()) && !(ota && ota.includes(note.trim()))) out.push({ key: "note", text: note });
  if (guest.trim() && !(ota && (ota.trim() === guest.trim() || ota.includes(guest.trim())))) out.push({ key: "guest", text: guest });
  return out;
}

// Contatti dall'OTA = dati non fidati: in un href `mailto:`/`tel:` un "?bcc=…" o "&body=…" precompilerebbe altri campi del client di posta.
const stripHrefUnsafe = (s?: string | null) => String(s ?? "").replace(/[?&#\s]/g, "");

/** `mailto:` sicuro: via ? & # e spazi (niente parametri iniettati), poi encodeURI. undefined se non resta nulla. */
export function safeMailtoHref(email?: string | null): string | undefined {
  const v = stripHrefUnsafe(email);
  return v ? `mailto:${encodeURI(v)}` : undefined;
}

/** `tel:` sicuro: stessa pulizia di safeMailtoHref. undefined se non resta nulla. */
export function safeTelHref(phone?: string | null): string | undefined {
  const v = stripHrefUnsafe(phone);
  return v ? `tel:${encodeURI(v)}` : undefined;
}

/** Id Channex di una prenotazione importata (extId "channex:<uuid>"), altrimenti undefined. */
export function channexIdOf(extId?: string | null): string | undefined {
  if (typeof extId !== "string" || !extId.startsWith("channex:")) return undefined;
  const id = extId.slice("channex:".length).trim();
  return id || undefined;
}

/** Etichetta del canale come su Channex ("<portale> - <struttura>") per le prenotazioni arrivate da Channex; altrimenti il nome del canale. */
export function channelDisplay(o: { extId?: string | null; otaName?: string; channelLabel: string; structureName?: string }): string {
  const portal = (o.otaName ?? "").trim() || o.channelLabel;
  return channexIdOf(o.extId) && o.structureName ? `${portal} - ${o.structureName}` : portal;
}

/** Nome del Paese (italiano) dal codice ISO a 2 lettere; se non è un codice, il testo com'è. */
export function countryName(code?: string | null): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  if (!/^[A-Za-z]{2}$/.test(c)) return c;
  try { return new Intl.DisplayNames(["it"], { type: "region" }).of(c.toUpperCase()) || c; } catch { return c; }
}

/** Nome della lingua (italiano) dal codice ("en" → "inglese"); se non riconosciuto, il codice com'è. */
export function languageName(code?: string | null): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(c)) return c;
  try { return new Intl.DisplayNames(["it"], { type: "language" }).of(c) || c; } catch { return c; }
}
