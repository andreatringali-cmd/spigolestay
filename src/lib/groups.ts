// Prenotazioni di gruppo: un groupId da solo non basta (le importazioni da OTA lo assegnano anche a una singola camera).
// Un gruppo vero ha almeno DUE prenotazioni attive con lo stesso groupId.
export function groupSizes(bookings: { groupId?: string; status: string; channel: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bookings) {
    if (!b.groupId || b.status === "cancelled" || b.channel === "blocked") continue;
    m.set(b.groupId, (m.get(b.groupId) ?? 0) + 1);
  }
  return m;
}
export const isRealGroup = (sizes: Map<string, number>, groupId?: string) => !!groupId && (sizes.get(groupId) ?? 0) > 1;
