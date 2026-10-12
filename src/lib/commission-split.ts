/** Divide la commissione di una prenotazione multi-camera tra le camere, in proporzione al totale di ciascuna; il resto va all'ultima. */
export function splitCommission(commission: number | undefined, roomTotals: number[]): (number | undefined)[] {
  if (commission == null) return roomTotals.map(() => undefined);
  if (roomTotals.length <= 1) return [commission];
  const sum = roomTotals.reduce((a, x) => a + (x > 0 ? x : 0), 0);
  const out: number[] = [];
  let used = 0;
  roomTotals.forEach((t, i) => {
    const share = i === roomTotals.length - 1 ? Math.round((commission - used) * 100) / 100 : Math.round(commission * (sum > 0 ? (t > 0 ? t : 0) / sum : 1 / roomTotals.length) * 100) / 100;
    used += share; out.push(share);
  });
  // Per arrotondamento l'ultima quota può uscire di -0,01: si azzera e si toglie la differenza alla quota più grande, così la somma resta uguale alla commissione.
  const last = out.length - 1;
  if (out[last] < 0) {
    const excess = -out[last];
    out[last] = 0;
    let big = 0;
    for (let i = 1; i < last; i++) if (out[i] > out[big]) big = i;
    out[big] = Math.round((out[big] - excess) * 100) / 100;
  }
  return out;
}