// Regole del polling dei messaggi OTA (logica pura, testabile).
// La chiave Channex è unica per tutti i clienti (20 richieste/min condivise): niente polling a raffica, sovrapposto o su schede dimenticate aperte.

export const OTA_POLL_MS = 60_000;            // aggiornamento dei messaggi
export const OTA_POLL_IDLE_MS = 10 * 60_000;  // dopo 10 minuti senza interazione l'aggiornamento si ferma

export type PollVerdict = "poll" | "skip" | "stop";

/** Cosa fare a ogni tick: "stop" = utente inattivo da troppo (ferma il timer), "skip" = pagina nascosta o richiesta ancora in corso, "poll" = aggiorna. */
export function pollVerdict(o: { now: number; lastInteraction: number; visible: boolean; inFlight: number; idleMs?: number }): PollVerdict {
  if (o.now - o.lastInteraction > (o.idleMs ?? OTA_POLL_IDLE_MS)) return "stop";
  if (!o.visible || o.inFlight > 0) return "skip";
  return "poll";
}

/** Dopo un'interazione con il timer fermo: conviene riaggiornare subito solo se la pagina è visibile e non c'è già una richiesta. */
export function shouldRefreshOnResume(o: { wasIdle: boolean; visible: boolean; inFlight: number }): boolean {
  return o.wasIdle && o.visible && o.inFlight === 0;
}
