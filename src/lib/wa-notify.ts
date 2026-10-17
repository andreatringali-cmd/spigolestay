// Scelta della struttura a cui riferire un messaggio WhatsApp dell'ospite (notifica email al titolare). Pura, senza rete.
export interface WaStructure { id?: string; name?: string; email?: string; photoColor?: string; logo?: string }
interface BookingRef { id?: string; structureId?: string; guestId?: string; status?: string; channel?: string; checkIn?: string; checkOut?: string }

/**
 * Struttura della prenotazione dell'ospite (la più vicina: in corso o futura, altrimenti l'ultima) se ha un'email; altrimenti la prima struttura con email,
 * altrimenti la prima. Prima si prendeva sempre «la prima con email»: con più strutture l'avviso partiva con il nome e il logo sbagliati.
 */
export function notifyStructure<S extends WaStructure>(structures: S[], bookings: BookingRef[], guestId: string | undefined, today: string): S | undefined {
  if (guestId) {
    const mine = bookings
      .filter((b) => b.guestId === guestId && b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked")
      .sort((a, b) => ((a.checkOut ?? "") >= today ? 0 : 1) - ((b.checkOut ?? "") >= today ? 0 : 1) || ((a.checkOut ?? "") >= today ? ((a.checkIn ?? "") < (b.checkIn ?? "") ? -1 : 1) : ((a.checkIn ?? "") < (b.checkIn ?? "") ? 1 : -1)));
    const own = structures.find((s) => s.id === mine[0]?.structureId);
    if (own?.email) return own;
  }
  return structures.find((s) => s.email) ?? structures[0];
}
