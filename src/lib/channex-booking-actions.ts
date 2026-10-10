// ============================================================
//  Segnalazioni all'OTA via Channex "Reporting API" — SOLO Booking.com.
//  Documentazione: https://docs.channex.io/api-v.1-documentation/bookings-collection.md
//  (sezione Reporting API: "At this time, we support Booking.com Reporting API
//  (No Show, Invalid Card, Cancel Due Invalid Card)"). Expedia NON è documentata.
//
//  ATTENZIONE: azioni ad alto rischio (hanno effetto reale su ospite e commissioni).
//  Questo modulo è PURO (niente rete, niente import con alias): contiene solo
//  validazione e costruzione della richiesta. Va invocato SOLO da un'azione esplicita
//  dell'utente (finestra di conferma con parola scritta) — MAI da cron/webhook/autopilot.
// ============================================================

export type OtaAction = "no_show" | "no_show_waived" | "invalid_card" | "cancel_invalid_card";

export const OTA_ACTIONS: OtaAction[] = ["no_show", "no_show_waived", "invalid_card", "cancel_invalid_card"];

export interface OtaActionInfo {
  label: string;       // voce di menu
  title: string;       // titolo della finestra di conferma
  effect: string;      // cosa succede davvero (mostrato prima della conferma)
  window: string;      // finestra temporale ammessa da Booking.com (da documentazione)
  confirmWord: string; // parola da scrivere per confermare
  logLabel: string;    // testo registrato nella nota della prenotazione
}

export const OTA_ACTION_INFO: Record<OtaAction, OtaActionInfo> = {
  no_show: {
    label: "Segnala no-show",
    title: "Segnala no-show a Booking.com",
    effect: "Comunichi a Booking.com che l'ospite NON si è presentato. Booking.com potrà applicare le penali previste dalla tariffa all'ospite. L'azione non è annullabile da qui.",
    window: "Possibile dalle 00:00 (ora locale della struttura) del giorno di check-in e per le 48 ore successive; la prenotazione deve essere modificabile e non in overbooking.",
    confirmWord: "NOSHOW",
    logLabel: "no-show segnalato a Booking.com",
  },
  no_show_waived: {
    label: "Segnala no-show senza addebito (rinuncia alla penale)",
    title: "Segnala no-show a Booking.com rinunciando alla penale",
    effect: "Comunichi a Booking.com il no-show ma dichiari che la struttura RINUNCIA alle penali di no-show (waived_fees = true): all'ospite non verrà addebitato nulla. Non è la richiesta di esenzione dalla commissione di Booking.com: quella non risulta documentata da Channex.",
    window: "Possibile dalle 00:00 (ora locale della struttura) del giorno di check-in e per le 48 ore successive; la prenotazione deve essere modificabile e non in overbooking.",
    confirmWord: "NOSHOW",
    logLabel: "no-show segnalato a Booking.com con rinuncia alla penale",
  },
  invalid_card: {
    label: "Segnala carta non valida",
    title: "Segnala carta non valida a Booking.com",
    effect: "Comunichi a Booking.com che la carta di garanzia dell'ospite non è valida. Booking.com avvisa l'ospite e gli chiede di aggiornarla; senza aggiornamento potrai poi chiedere l'annullamento.",
    window: "Possibile subito dopo la prenotazione e fino alle 00:00 del giorno di check-in (ora locale della struttura).",
    confirmWord: "CARTA",
    logLabel: "carta non valida segnalata a Booking.com",
  },
  cancel_invalid_card: {
    label: "Annulla per carta non valida",
    title: "Annulla la prenotazione per carta non valida",
    effect: "ANNULLI la prenotazione su Booking.com perché la carta resta non valida. La camera torna in vendita e l'ospite perde la prenotazione. Azione IRREVERSIBILE.",
    window: "Solo se non arrivano dati carta aggiornati entro 24 ore (12 ore o le 15:00 se la prenotazione è a meno di 48 ore dal check-in; mai meno di 2 ore; 2 ore per last-minute da 10+ notti) o se l'ospite reinvia una carta non valida. Prima devi aver segnalato la carta non valida.",
    confirmWord: "ANNULLA",
    logLabel: "prenotazione annullata su Booking.com per carta non valida",
  },
};

// Solo prenotazioni importate da Channex (extId = "channex:<booking_id>") sul canale Booking.com.
// Expedia è escluso di proposito: la documentazione Channex non prevede queste azioni per Expedia.
export function channexBookingIdFromExtId(extId?: string | null): string | null {
  if (typeof extId !== "string" || !extId.startsWith("channex:")) return null;
  const id = extId.slice("channex:".length).trim();
  return id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}
export function canReportToOta(b: { channel?: string; extId?: string | null; status?: string }): boolean {
  return b.channel === "booking" && !!channexBookingIdFromExtId(b.extId) && b.status !== "cancelled" && b.status !== "tentative";
}

export interface OtaActionRequest { bookingId: string; action: OtaAction; confirm: string }
export type ParsedOtaAction = { ok: true; value: OtaActionRequest } | { ok: false; error: string };

// Validazione input della route: azione tra quelle note, id booking plausibile e
// parola di conferma ESATTA (difesa in profondità: anche lato server, non solo nella UI).
export function parseOtaActionInput(body: unknown): ParsedOtaAction {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = typeof b.action === "string" ? (b.action.trim() as OtaAction) : ("" as OtaAction);
  if (!OTA_ACTIONS.includes(action)) return { ok: false, error: "azione_non_valida" };
  const bookingId = typeof b.bookingId === "string" ? b.bookingId.trim() : "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(bookingId)) return { ok: false, error: "bookingId_non_valido" };
  const confirm = typeof b.confirm === "string" ? b.confirm.trim() : "";
  if (confirm !== OTA_ACTION_INFO[action].confirmWord) return { ok: false, error: "conferma_mancante" };
  return { ok: true, value: { bookingId, action, confirm } };
}

// Percorso (relativo alla base Channex) e corpo della richiesta per ciascuna azione.
export function otaActionRequest(action: OtaAction, bookingId: string): { path: string; body: string | undefined } {
  const id = encodeURIComponent(bookingId);
  switch (action) {
    case "no_show": return { path: `/bookings/${id}/no_show`, body: JSON.stringify({ no_show_report: { waived_fees: false } }) };
    case "no_show_waived": return { path: `/bookings/${id}/no_show`, body: JSON.stringify({ no_show_report: { waived_fees: true } }) };
    case "invalid_card": return { path: `/bookings/${id}/invalid_card`, body: undefined }; // payload vuoto
    case "cancel_invalid_card": return { path: `/bookings/${id}/cancel_due_invalid_card`, body: undefined };
  }
}

// Suggerimento (NON bloccante) sulla finestra temporale: il fuso della struttura non è noto qui
// e il controllo vero lo fa Booking.com (risponde 422 se fuori finestra).
export function windowHint(action: OtaAction, checkInISO: string, todayISO: string): string | null {
  if (action === "no_show" || action === "no_show_waived") {
    if (todayISO < checkInISO) return "Il check-in è nel futuro: Booking.com accetta il no-show solo dal giorno di check-in.";
    const days = Math.round((Date.parse(todayISO) - Date.parse(checkInISO)) / 86400000);
    if (days > 2) return "Sono passati più di 2 giorni dal check-in: la finestra di 48 ore è probabilmente scaduta.";
  }
  if (action === "invalid_card" && todayISO >= checkInISO) return "Il giorno di check-in è iniziato: la segnalazione di carta non valida è ammessa solo fino alla mezzanotte del check-in.";
  return null;
}

// Riga da accodare alla nota della prenotazione dopo l'esito.
export function otaLogLine(action: OtaAction, ok: boolean, whenISO: string, detail?: string): string {
  const d = whenISO.slice(0, 16).replace("T", " ");
  const base = OTA_ACTION_INFO[action].logLabel;
  return ok ? `[${d}] ${base}.` : `[${d}] TENTATIVO FALLITO: ${base}${detail ? ` — ${detail.slice(0, 160)}` : ""}.`;
}
