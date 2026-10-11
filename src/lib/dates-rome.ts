// Date "di calendario" nel fuso orario italiano (Europe/Rome).
// Il server (Vercel) gira in UTC: new Date().toISOString().slice(0, 10) tra mezzanotte
// e le 1/2 italiane restituisce ancora il giorno PRIMA. Queste funzioni sono pure e
// non dipendono dal fuso del processo.

const TZ = "Europe/Rome";

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Data (YYYY-MM-DD) del giorno di calendario italiano in cui cade l'istante `date`. */
export function ymdRome(date: Date | number | string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new RangeError("ymdRome: data non valida");
  let y = "", m = "", day = "";
  for (const p of fmt.formatToParts(d)) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
    else if (p.type === "day") day = p.value;
  }
  return `${y.padStart(4, "0")}-${m}-${day}`;
}

/** "Oggi" in Italia (YYYY-MM-DD). `now` è iniettabile per i test. */
export function todayRome(now: Date = new Date()): string {
  return ymdRome(now);
}

/** Somma/sottrae giorni a una data YYYY-MM-DD (aritmetica di calendario, immune al cambio ora). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
