// Utility date (senza dipendenze).

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Sposta una data ISO di N giorni, restituendo ISO.
export function shiftISO(iso: string, days: number): string {
  return toISO(addDays(parseISO(iso), days));
}

// Numero di notti tra due date ISO.
export function nights(checkIn: string, checkOut: string): number {
  const a = parseISO(checkIn).getTime();
  const b = parseISO(checkOut).getTime();
  return Math.round((b - a) / 86_400_000);
}

// Indice (in giorni) di una data rispetto a un inizio.
export function dayIndex(start: Date, iso: string): number {
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const b = parseISO(iso).getTime();
  return Math.round((b - a) / 86_400_000);
}

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
const MONTHS = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

export function weekdayShort(d: Date): string {
  return WEEKDAYS[d.getDay()];
}

export function monthLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function isWeekend(d: Date): boolean {
  const g = d.getDay();
  return g === 0 || g === 6;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "2026-10-29" → "29.10.2026" (gg.mm.aaaa). Se non è una data ISO valida restituisce il testo com'è. */
/**
 * Data per la VISUALIZZAZIONE nel formato unico dell'app: gg.mm.aaaa. Accetta una stringa ISO (anche con ora), un Date o un timestamp in ms; vuoto/non valido → "" (o il testo originale se è una stringa).
 * Un Date/timestamp è letto nel fuso del dispositivo (come toLocaleDateString); la stringa ISO yyyy-mm-dd NON cambia mai per il fuso.
 */
export function fmtDate(v?: Date | string | number | null): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") return fmtDMY(v);
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
/** Giorno e mese senza anno: gg.mm (per etichette brevi dove l'anno è ovvio). */
export function fmtDM(v?: Date | string | number | null): string {
  const s = fmtDate(v);
  return s.length >= 10 ? s.slice(0, 5) : s;
}
/** Data e ora: gg.mm.aaaa HH:MM (fuso del dispositivo). */
export function fmtDateTime(v?: Date | string | number | null): string {
  if (v === null || v === undefined || v === "") return "";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return typeof v === "string" ? v : "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${fmtDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtDMY(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? "");
}
