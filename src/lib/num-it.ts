// Numeri scritti a mano in formato italiano (virgola decimale). Modulo puro: lo usano i campi importo (NumInput) e i test.
//
// Perché esiste: un <input type="number"> con locale italiano restituisce "" mentre l'utente digita "75," (valore non ancora valido),
// e `+""` fa 0: il campo si azzerava. Qui si tiene il TESTO digitato e lo si interpreta noi.

/** Caratteri ammessi mentre si digita un importo: cifre, virgola, punto, meno, spazi. */
export const NUM_TYPING_RE = /^[\d.,\s -]*$/;

/**
 * Interpreta un importo scritto a mano. Restituisce null se il testo è vuoto o non è un numero ("", "-", "abc").
 *  - "75,70" → 75.7 · "75.70" → 75.7 · "75," → 75 · "75." → 75 · ",5" → 0.5
 *  - "1.234,50" → 1234.5 · "1,234.50" → 1234.5 (l'ultimo separatore è quello decimale)
 *  - "1.234" → 1234 (un solo punto seguito da 3 cifre dopo 1-3 cifre = migliaia, all'italiana) · "12.5" → 12.5 · "0.125" → 0.125
 *  - "1.234.567" → 1234567 · "€ 75,7" → 75.7
 */
export function parseDecimalIT(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? "").replace(/[€\s ]/g, "");
  if (!s) return null;
  let neg = false;
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (!s || /[^\d.,]/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let decPart = "";
  if (lastComma >= 0 && lastDot >= 0) {
    // entrambi: l'ultimo dei due è il separatore decimale, l'altro delle migliaia
    const sep = Math.max(lastComma, lastDot);
    if (s.slice(0, sep).includes(s[sep])) return null; // il separatore decimale compare una volta sola
    intPart = s.slice(0, sep).replace(/[.,]/g, "");
    decPart = s.slice(sep + 1);
    if (/[.,]/.test(decPart)) return null;
  } else if (lastComma >= 0) {
    const parts = s.split(",");
    if (parts.length > 2) { intPart = parts.join(""); } // "1,234,567": virgole come migliaia
    else { intPart = parts[0]; decPart = parts[1]; }
  } else if (lastDot >= 0) {
    const parts = s.split(".");
    if (parts.length > 2) { intPart = parts.join(""); } // "1.234.567": punti come migliaia
    else if (parts[1].length === 3 && /^[1-9]\d{0,2}$/.test(parts[0])) { intPart = parts[0] + parts[1]; } // "1.234": migliaia
    else { intPart = parts[0]; decPart = parts[1]; }
  } else {
    intPart = s;
  }
  if (!intPart && !decPart) return null;
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) return null;
  const n = Number(`${intPart || "0"}${decPart ? "." + decPart : ""}`);
  if (!Number.isFinite(n)) return null;
  return neg ? (n === 0 ? 0 : -n) : n;
}

/** Arrotonda a `decimals` cifre (default 2, i centesimi), correggendo i casi tipo 1.005. */
export function roundDecimals(n: number, decimals = 2): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimals;
  const r = Math.round(Math.abs(n) * f * (1 + Number.EPSILON)) / f;
  const v = n < 0 ? -r : r;
  return v === 0 ? 0 : v;
}

/**
 * Numero → testo per il campo, con la virgola italiana e senza separatore delle migliaia (si deve poter riscrivere):
 * 75 → "75", 75.7 → "75,70", 1234.5 → "1234,50". Gli interi restano senza decimali.
 */
export function formatDecimalIT(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const r = roundDecimals(n, decimals);
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(decimals).replace(".", ",");
}
