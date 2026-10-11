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
  return out;
}