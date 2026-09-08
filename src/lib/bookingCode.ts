import type { Booking } from "./types";

// Codice prenotazione mostrato all'ospite. Le prenotazioni vecchie (prima del campo `code`)
// ricadono sui primi 8 caratteri dell'id tecnico, in maiuscolo.
export function bookingCode(b: Pick<Booking, "id" | "code">): string {
  return b.code ?? b.id.slice(0, 8).toUpperCase();
}
