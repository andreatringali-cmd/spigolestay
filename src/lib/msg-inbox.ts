// Regole PURE dell'elenco Messaggi OTA (filtri, ordine, tempo di attesa). Nessun accesso a browser o rete: la pagina le usa e i test le provano.
import type { OtaThread } from "./channex-threads";
import { noReplyActive, seenAtOf, type MsgState } from "./msg-state";

export type InboxFilter = "waiting" | "unread" | "all" | "noreply";
export type InboxSort = "recent" | "arrival";

export const OVERDUE_MS = 24 * 3600 * 1000; // oltre 24 ore senza risposta l'attesa diventa «in ritardo» (rosso)

export interface ThreadFlags {
  unread: boolean;   // l'ultimo messaggio non è mio ed è più recente dell'ultima volta che QUALCUNO l'ha vista
  waiting: boolean;  // aperta, ultimo messaggio dell'ospite, senza risposta nostra e non segnata «non serve rispondere»
  noReply: boolean;  // segnata «non serve rispondere» (e l'ospite non ha scritto ancora dopo)
  waitMs: number;    // da quanto aspetta una risposta (0 se non è in attesa)
  overdue: boolean;  // in attesa da più di 24 ore
}

/** Segni di una conversazione. `openId` = la conversazione aperta ora: si considera letta mentre la guardo. */
export function threadFlags(t: OtaThread, state: MsgState, now: number, openId?: string | null): ThreadFlags {
  const nr = !t.closed && noReplyActive(state, t.id, t.lastAt);
  const waiting = !t.closed && t.lastSender === "guest" && !nr;
  const waitMs = waiting && t.lastAt ? Math.max(0, now - t.lastAt) : 0;
  return {
    unread: t.id !== openId && t.lastSender !== "property" && t.lastAt > seenAtOf(state, t.id),
    waiting, noReply: nr, waitMs, overdue: waitMs > OVERDUE_MS,
  };
}

export const matchesFilter = (f: ThreadFlags, filter: InboxFilter): boolean =>
  filter === "waiting" ? f.waiting : filter === "unread" ? f.unread : filter === "noreply" ? f.noReply : true;

export function countByFilter(flags: ThreadFlags[]): Record<InboxFilter, number> {
  const c: Record<InboxFilter, number> = { waiting: 0, unread: 0, all: flags.length, noreply: 0 };
  for (const f of flags) { if (f.waiting) c.waiting++; if (f.unread) c.unread++; if (f.noReply) c.noreply++; }
  return c;
}

/** «in attesa da …»: minuti sotto l'ora, ore fino a 2 giorni, poi giorni. */
export function waitLabel(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "meno di 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} g`;
}

const dayNum = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

/**
 * Posizione per «Arrivo più vicino» (più piccolo = prima): prima chi arriva oggi o in futuro (dal più vicino), poi chi è già arrivato (dal più recente),
 * poi le annullate, infine le conversazioni senza prenotazione.
 */
export function arrivalRank(b: { checkIn: string; status?: string } | undefined, today: string): number {
  if (!b || !/^\d{4}-\d{2}-\d{2}/.test(b.checkIn)) return 3e9;
  const d = dayNum(b.checkIn) - dayNum(today);
  if (b.status === "cancelled") return 2e9 + Math.abs(d);
  return d >= 0 ? d : 1e9 + Math.abs(d);
}

/** Ordina senza modificare l'elenco. «recent» = ultimo messaggio più recente; «arrival» = arrivo più vicino, a parità il messaggio più recente. */
export function sortRows<T extends { t: OtaThread; rank: number }>(rows: T[], sort: InboxSort): T[] {
  const out = [...rows];
  out.sort(sort === "arrival" ? (a, b) => (a.rank - b.rank) || (b.t.lastAt - a.t.lastAt) : (a, b) => b.t.lastAt - a.t.lastAt);
  return out;
}
