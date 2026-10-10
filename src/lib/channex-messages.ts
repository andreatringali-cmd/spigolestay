// Messaggi degli ospiti dalle OTA (Booking.com, Airbnb, Expedia) in arrivo da Channex col webhook "message".
// Moduli puri (nessun accesso a rete/DB): il webhook li usa e i test li provano da soli.
import { createHmac, timingSafeEqual } from "node:crypto";

const DATA_KEY = "spigolestay:data:v1";
const THREADS_KEY = "spigolestay:threads:v1";

export interface InboundOtaMessage { id: string; text: string; bookingId: string; propertyId: string }
type Thread = { id: string; dir: "in" | "out"; text: string; ts: number; via?: string }[];

/** Estrae il messaggio dell'ospite dal corpo del webhook; null se non è un messaggio dell'ospite da mostrare. */
export function parseChannexMessage(body: unknown): InboundOtaMessage | null {
  const b = (body ?? {}) as { event?: string; property_id?: string; payload?: Record<string, unknown> };
  if (b.event !== "message") return null;
  const p = b.payload ?? {};
  if (p.sender !== "guest") return null; // le nostre risposte sono già nel thread
  const id = String(p.id ?? p.ota_message_id ?? "").trim();
  const bookingId = String(p.booking_id ?? "").trim();
  const propertyId = String(p.property_id ?? b.property_id ?? "").trim();
  if (!id || !bookingId || !propertyId) return null;
  const raw = typeof p.message === "string" ? p.message.trim() : "";
  const text = raw || (p.have_attachment ? "📎 Allegato (aprilo su Booking.com, Airbnb o Expedia)" : "");
  if (!text) return null;
  return { id, text, bookingId, propertyId };
}

// Stessa funzione di ota-label.ts (lì per il browser): qui copiata perché i test Node non risolvono import senza estensione.
export function otaLabel(channel?: string): string {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("booking")) return "Booking.com";
  if (c.includes("airbnb")) return "Airbnb";
  if (c.includes("expedia") || c.includes("vrbo")) return "Expedia";
  return "OTA";
}

export type AppendResult =
  | { status: "added"; guestId: string; bookingId: string; channel: string }
  | { status: "duplicate" }
  | { status: "no_booking" };

/** Aggiunge il messaggio al thread dell'ospite dentro il blob di stato (modifica `blob` sul posto). Idempotente sull'id del messaggio. */
export function appendOtaMessage(blob: Record<string, string>, msg: InboundOtaMessage, now: number): AppendResult {
  let data: { bookings?: { id?: string; extId?: string; guestId?: string; channel?: string }[] } = {};
  try { data = JSON.parse(blob[DATA_KEY] || "{}"); } catch { data = {}; }
  const booking = (Array.isArray(data.bookings) ? data.bookings : []).find((x) => x.extId === `channex:${msg.bookingId}`);
  if (!booking?.guestId) return { status: "no_booking" };
  let threads: Record<string, Thread> = {};
  try { threads = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { threads = {}; }
  const mid = `chx:${msg.id}`;
  const list = threads[booking.guestId] ?? [];
  if (list.some((m) => m.id === mid)) return { status: "duplicate" };
  threads[booking.guestId] = [...list, { id: mid, dir: "in", text: msg.text, ts: now, via: otaLabel(booking.channel) }];
  blob[THREADS_KEY] = JSON.stringify(threads);
  return { status: "added", guestId: booking.guestId, bookingId: booking.id ?? "", channel: otaLabel(booking.channel) };
}

type Env = Record<string, string | undefined>;

/** Segreto condiviso con Channex (intestazione del webhook), derivato da un segreto già presente su Vercel. Vuoto se non disponibile. */
function hookSecret(label: string, env: Env): string {
  const base = env.CRON_SECRET || env.CRED_SECRET || "";
  return base ? createHmac("sha256", base).update(label).digest("hex") : "";
}
/** Segreto del webhook dei MESSAGGI delle OTA. */
export function messageHookSecret(env: Env = process.env): string { return hookSecret("channex-message-webhook", env); }
/** Segreto del webhook delle PRENOTAZIONI (stessa derivazione, etichetta diversa: i due segreti non sono intercambiabili). */
export function bookingHookSecret(env: Env = process.env): string { return hookSecret("channex-booking-webhook", env); }

/** Nome dell'intestazione con cui Channex invia il segreto. */
export const HOOK_SECRET_HEADER = "x-xenora-secret";

const isProd = (env: Env) => env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type HookVerdict = { accept: boolean; reason: "ok" | "no_secret_dev" | "no_secret_prod" | "bad_secret" | "missing_secret_legacy" | "missing_secret_strict" | "no_secret_legacy" };

/**
 * Webhook MESSAGGI: fallisce in chiusura. Senza segreto configurato in produzione NON si elabora nulla
 * (prima si saltava il controllo); in locale/sviluppo senza segreto si accetta per poter provare.
 */
export function verifyMessageHook(provided: string | null | undefined, env: Env = process.env): HookVerdict {
  const expected = messageHookSecret(env);
  if (!expected) return isProd(env) ? { accept: false, reason: "no_secret_prod" } : { accept: true, reason: "no_secret_dev" };
  return provided && safeEqual(provided, expected) ? { accept: true, reason: "ok" } : { accept: false, reason: "bad_secret" };
}

/**
 * Webhook PRENOTAZIONI: retrocompatibile. I webhook già registrati su Channex non hanno ancora l'intestazione,
 * quindi una chiamata SENZA segreto resta accettata (con avviso nel log) finché non si imposta CHANNEX_WEBHOOK_STRICT=1.
 * Un segreto presente ma SBAGLIATO è sempre rifiutato. In modalità strict anche l'assenza di segreto (o di configurazione) è rifiutata.
 */
export function verifyBookingHook(provided: string | null | undefined, env: Env = process.env): HookVerdict {
  const strict = env.CHANNEX_WEBHOOK_STRICT === "1";
  const expected = bookingHookSecret(env);
  if (!expected) return strict ? { accept: false, reason: "no_secret_prod" } : { accept: true, reason: "no_secret_legacy" };
  if (provided) return safeEqual(provided, expected) ? { accept: true, reason: "ok" } : { accept: false, reason: "bad_secret" };
  return strict ? { accept: false, reason: "missing_secret_strict" } : { accept: true, reason: "missing_secret_legacy" };
}
