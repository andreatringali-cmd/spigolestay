// Formattazione italiana (manuale, indipendente dall'ICU del runtime).

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Euro con separatore migliaia e 2 decimali: "€ 8.140,00".
// Valori non numerici (NaN, undefined, Infinity) → "€ 0,00"; "-0" e gli importi che arrotondano a zero non hanno il segno meno.
export function eur(n: number | null | undefined, cur = "€"): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  const [int, dec] = Math.abs(v).toFixed(2).split(".");
  const neg = v < 0 && (Number(int) !== 0 || Number(dec) !== 0);
  return `${neg ? "-" : ""}${cur} ${group(int)},${dec}`;
}

// Numero intero con separatore migliaia: "1.234".
export function num(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return `${v < 0 ? "-" : ""}${group(String(Math.abs(v)))}`;
}
