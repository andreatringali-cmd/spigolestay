// Messaggi per l'ospite quando la prenotazione dal sito pubblico non va a buon fine.
// Funzione pura (testabile). Si basa sullo stato HTTP e sul codice `error` delle API
// /api/stripe/book e /api/public-booking.

export function bookingErrorMessage(status: number, code?: string): string {
  if (status === 409 || code === "no_availability") {
    return "Le date selezionate non sono più disponibili: qualcun altro ha appena prenotato. Scegli altre date o un'altra camera e riprova.";
  }
  if (status === 429 || code === "troppe_richieste") {
    return "Troppi tentativi ravvicinati. Attendi un minuto e riprova.";
  }
  if (code === "bad_dates") {
    return "Le date scelte non sono valide per la prenotazione online. Controlla arrivo e partenza e riprova.";
  }
  if (code === "price_mismatch") {
    return "Il prezzo è cambiato: ricarica la pagina, verifica di nuovo la disponibilità e riprova.";
  }
  if (status === 404 || code === "site_not_found") {
    return "Questa struttura non accetta prenotazioni online al momento. Contatta direttamente la struttura.";
  }
  return "Non è stato possibile completare la prenotazione. Nessun addebito è stato effettuato e la prenotazione non è stata registrata. Riprova tra poco o contatta la struttura.";
}

export const BOOKING_NETWORK_ERROR =
  "Connessione assente o instabile: la prenotazione non è stata registrata. Controlla la connessione e riprova.";
