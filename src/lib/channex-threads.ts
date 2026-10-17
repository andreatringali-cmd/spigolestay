// Messaggi 2: conversazioni con gli ospiti delle OTA (Booking.com, Airbnb, Expedia) lette DIRETTAMENTE da Channex (Messages API a "thread").
// Moduli puri (nessuna rete/DB): la route /api/channex/threads li usa per normalizzare le risposte e per i controlli di proprietà; la pagina li usa per mostrarle.
import type { Channel } from "./types";

export type ThreadProvider = "BookingCom" | "Airbnb" | "Expedia" | string;
export interface OtaThread {
  id: string; title: string; provider: ThreadProvider; closed: boolean; count: number;
  lastMessage: string; lastAt: number;            // ms; 0 se sconosciuto
  lastSender: "guest" | "property" | "system" | "";   // chi ha scritto l ultimo messaggio (per il segno "da leggere")
  bookingId: string; propertyId: string;          // id Channex (booking può mancare: richieste di informazioni Airbnb)
}
export interface OtaMsg { id: string; text: string; sender: "guest" | "property" | "system"; ts: number; att: { url: string; name?: string }[] }

type Row = { id?: unknown; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id?: unknown } | null } | undefined> } & Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
// Channex scrive gli orari senza fuso ("2021-07-28T04:25:15.000000") ma sono UTC: senza la Z si leggerebbero come ora locale.
const ms = (v: unknown): number => { if (typeof v !== "string" || !v.trim()) return 0; const x = v.trim(); const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(x) ? x : `${x}Z`); return Number.isFinite(t) ? t : 0; };
const senderOf = (v: unknown): "guest" | "property" | "system" | "" => (v === "guest" ? "guest" : v === "system" ? "system" : v === "property" ? "property" : "");
const relId = (r: Row, key: string): string => { const d = r.relationships?.[key]?.data; return d && typeof d === "object" ? str((d as { id?: unknown }).id) : ""; };

/** Riga della lista/dettaglio thread di Channex → thread normalizzato. null se manca l'id. */
export function normalizeThread(row: unknown): OtaThread | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Row;
  const a = (r.attributes ?? {}) as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const count = typeof a.message_count === "number" && Number.isFinite(a.message_count) ? a.message_count : 0;
  // Nella risposta reale last_message è un OGGETTO {message, sender, inserted_at, attachments}; si accetta anche una stringa semplice.
  const lm = a.last_message && typeof a.last_message === "object" ? (a.last_message as Record<string, unknown>) : null;
  const lmText = lm ? (str(lm.message).trim() || (Array.isArray(lm.attachments) && lm.attachments.length ? "📎 Allegato" : "")) : str(a.last_message);
  return {
    id, title: str(a.title), provider: str(a.provider), closed: a.is_closed === true, count,
    lastMessage: lmText, lastSender: lm ? senderOf(lm.sender) : "",
    lastAt: ms(a.last_message_received_at) || (lm ? ms(lm.inserted_at) : 0) || ms(a.updated_at) || ms(a.inserted_at),
    bookingId: relId(r, "booking"), propertyId: relId(r, "property"),
  };
}

/** Messaggio Channex → messaggio normalizzato. `toUrl` completa gli indirizzi relativi degli allegati (parseAttachments di channex-messages.ts). */
export function normalizeMessage(row: unknown, toUrl: (raw: unknown) => { url: string; name?: string }[]): OtaMsg | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Row;
  const a = (r.attributes ?? r) as Record<string, unknown>;
  const id = str(r.id) || str(a.id);
  if (!id) return null;
  const s = str(a.sender);
  return { id, text: str(a.message), sender: s === "guest" ? "guest" : s === "system" ? "system" : "property", ts: ms(a.inserted_at) || ms(a.updated_at), att: toUrl(a.attachments) };
}

/** Provider della conversazione → canale Xenora (per il logo). */
export function providerChannel(provider: ThreadProvider): Channel {
  const p = provider.toLowerCase().replace(/[\s._-]+/g, "");
  if (p === "booking" || p.startsWith("bookingcom")) return "booking"; // non "123booking", "Simplebooking", ...
  if (p.includes("airbnb")) return "airbnb";
  if (p.includes("expedia") || p.includes("vrbo")) return "expedia";
  return "other";
}
export const providerLabel = (provider: ThreadProvider): string => {
  const c = providerChannel(provider);
  return c === "booking" ? "Booking.com" : c === "airbnb" ? "Airbnb" : c === "expedia" ? "Expedia" : provider || "OTA";
};

/** L'account Channex è unico per tutti i clienti: una conversazione si mostra/usa SOLO se la sua property è tra quelle dell'utente. */
export const threadAllowed = (t: { propertyId: string }, allowed: Set<string>): boolean => !!t.propertyId && allowed.has(t.propertyId);

/** "Non è richiesta una risposta" esiste solo per Booking.com (Channex lo accetta solo lì). */
export const noReplySupported = (provider: ThreadProvider): boolean => providerChannel(provider) === "booking";

/** Unisce più liste (una per property) togliendo i doppioni, dalla conversazione più recente. */
export function mergeThreads(lists: OtaThread[][]): OtaThread[] {
  const byId = new Map<string, OtaThread>();
  for (const l of lists) for (const t of l) { const old = byId.get(t.id); if (!old || t.lastAt >= old.lastAt) byId.set(t.id, t); }
  return [...byId.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/** Tempo trascorso in italiano ("13 ore fa", "3 giorni fa"); gli ultimi 60 secondi "adesso". */
export function ago(ts: number, now = Date.now()): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "adesso";
  const m = Math.round(s / 60); if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60); if (h < 24) return `${h} ${h === 1 ? "ora" : "ore"} fa`;
  const d = Math.round(h / 24); if (d < 30) return `${d} ${d === 1 ? "giorno" : "giorni"} fa`;
  const mo = Math.round(d / 30); return `${mo} ${mo === 1 ? "mese" : "mesi"} fa`;
}

/** Conversazioni di UNA prenotazione (id prenotazione Channex), solo quelle di property consentite all'utente. */
export function threadsOfBooking(threads: OtaThread[], bookingId: string, allowed: Set<string>): OtaThread[] {
  const id = bookingId.trim();
  if (!id) return [];
  return threads.filter((t) => t.bookingId === id && threadAllowed(t, allowed));
}

/** Conversazione da mostrare nella scheda prenotazione: la più recente tra quelle aperte, altrimenti l'ultima (chiusa). null se non ce ne sono. */
export function pickBookingThread(threads: OtaThread[]): OtaThread | null {
  if (!threads.length) return null;
  const byRecent = [...threads].sort((a, b) => b.lastAt - a.lastAt);
  return byRecent.find((t) => !t.closed) ?? byRecent[0];
}
