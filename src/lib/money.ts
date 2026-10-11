// Importi in euro: aritmetica sui centesimi per evitare errori di virgola mobile
// (es. 0.1 + 0.2 = 0.30000000000000004). I dati restano in euro con 2 decimali.

/** Arrotonda un importo in euro al centesimo (mezzo centesimo verso l'alto, anche per i negativi in valore assoluto). */
export function roundCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  // Number.EPSILON corregge i casi tipo 1.005 -> 1.00 dovuti alla rappresentazione binaria.
  const cents = Math.round(Math.abs(n) * 100 * (1 + Number.EPSILON));
  const r = (sign * cents) / 100;
  return r === 0 ? 0 : r; // evita -0
}

/** Somma importi in euro arrotondando ogni addendo e il totale al centesimo. Ignora valori non numerici. */
export function sumCents(values: Iterable<number | null | undefined>): number {
  let cents = 0;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    cents += Math.round(roundCents(v) * 100);
  }
  return cents / 100;
}
