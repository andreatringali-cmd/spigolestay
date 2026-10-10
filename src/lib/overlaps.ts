// Prenotazioni che non trovano posto: due prenotazioni attive sulla stessa camera nelle stesse notti.
// In ogni camera resta quella che arriva per prima (i blocchi manuali hanno sempre la precedenza); quelle che si sovrappongono
// a una già tenuta vanno in "Da assegnare". Modulo puro: lo usano il Calendario e i test.

type B = { id: string; unitId?: string | null; status?: string; channel?: string; checkIn: string; checkOut: string };

const clash = (a: B, b: B) => a.checkIn < b.checkOut && b.checkIn < a.checkOut;

/** Id delle prenotazioni da togliere dalla loro camera perché non c'è posto. */
export function overlapLosers<T extends B>(bookings: T[], inScope: (b: T) => boolean = () => true): string[] {
  const byUnit = new Map<string, T[]>();
  for (const b of bookings) {
    if (!b.unitId || b.status === "cancelled" || !inScope(b)) continue;
    const arr = byUnit.get(b.unitId);
    if (arr) arr.push(b); else byUnit.set(b.unitId, [b]);
  }
  const losers: string[] = [];
  for (const list of byUnit.values()) {
    const sorted = [...list].sort((a, b) => (a.channel === "blocked" ? 0 : 1) - (b.channel === "blocked" ? 0 : 1) || a.checkIn.localeCompare(b.checkIn) || a.checkOut.localeCompare(b.checkOut) || a.id.localeCompare(b.id));
    const kept: T[] = [];
    for (const b of sorted) {
      if (kept.some((k) => clash(k, b))) losers.push(b.id); else kept.push(b);
    }
  }
  return losers;
}
