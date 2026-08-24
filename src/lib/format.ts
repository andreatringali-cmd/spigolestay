// Formattazione italiana (manuale, indipendente dall'ICU del runtime).

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Euro con separatore migliaia e 2 decimali: "€ 8.140,00".
export function eur(n: number): string {
  const neg = n < 0;
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return `${neg ? "-" : ""}€ ${group(int)},${dec}`;
}

// Numero intero con separatore migliaia: "1.234".
export function num(n: number): string {
  const neg = n < 0;
  return `${neg ? "-" : ""}${group(String(Math.abs(Math.round(n))))}`;
}
