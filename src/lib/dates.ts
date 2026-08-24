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
