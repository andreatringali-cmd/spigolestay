// Finestra di 24 ore di WhatsApp: la Cloud API consegna un testo libero SOLO se il destinatario ha scritto al numero della struttura nelle ultime 24 ore.
// Altrimenti Meta lo accetta ("inviato") ma poi non lo consegna (errore 131047). Modulo puro (niente storage): lo usano l'invio e i test.
type Msg = { dir?: string; ts?: number };

/** Margine di mezz'ora: si considera chiusa poco prima delle 24 ore, per non arrivare al limite. */
export const WA_WINDOW_MS = 23.5 * 3600 * 1000;

export function windowOpenFrom(threads: Record<string, Msg[]>, guestId: string, now = Date.now()): boolean {
  const last = Math.max(0, ...(threads[guestId] ?? []).filter((m) => m.dir === "in").map((m) => m.ts ?? 0));
  return now - last < WA_WINDOW_MS;
}
