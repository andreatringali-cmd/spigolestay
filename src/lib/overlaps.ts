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

type U = { id: string; roomTypeId: string; outOfService?: boolean };
type RT = { id: string; structureId?: string };

/**
 * Sistema le sovrapposizioni: ogni prenotazione che non trova posto va prima in un'altra camera libera della stessa struttura
 * (prima della stessa tipologia, poi di un'altra: una camera può essere venduta con più tipologie), e solo se non ce n'è nessuna in "Da assegnare".
 */
export function planOverlapFix<T extends B & { roomTypeId?: string; structureId?: string }>(bookings: T[], units: U[], roomTypes: RT[], inScope: (b: T) => boolean = () => true): { moves: { id: string; unitId: string }[]; unassign: string[] } {
  const loserIds = new Set(overlapLosers(bookings, inScope));
  const typeStruct = new Map(roomTypes.map((r) => [r.id, r.structureId]));
  const unitStruct = (u: U) => typeStruct.get(u.roomTypeId);
  // prenotazioni che restano dove sono, per camera (le sposteremo man mano che si riempiono)
  const placed = new Map<string, T[]>();
  for (const b of bookings) {
    if (!b.unitId || b.status === "cancelled" || loserIds.has(b.id)) continue;
    const arr = placed.get(b.unitId);
    if (arr) arr.push(b); else placed.set(b.unitId, [b]);
  }
  const moves: { id: string; unitId: string }[] = [];
  const unassign: string[] = [];
  const losers = bookings.filter((b) => loserIds.has(b.id)).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.id.localeCompare(b.id));
  for (const b of losers) {
    const cands = units.filter((u) => !u.outOfService && u.id !== b.unitId && (!b.structureId || unitStruct(u) === b.structureId))
      .sort((x, y) => (x.roomTypeId === b.roomTypeId ? 0 : 1) - (y.roomTypeId === b.roomTypeId ? 0 : 1));
    const free = cands.find((u) => !(placed.get(u.id) ?? []).some((k) => clash(k, b)));
    if (free) { moves.push({ id: b.id, unitId: free.id }); const arr = placed.get(free.id); if (arr) arr.push(b); else placed.set(free.id, [b]); }
    else unassign.push(b.id);
  }
  return { moves, unassign };
}
