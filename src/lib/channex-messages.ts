// Messaggi degli ospiti dalle OTA (Booking.com, Airbnb, Expedia) in arrivo da Channex col webhook "message".
// Moduli puri (nessun accesso a rete/DB): il webhook li usa e i test li provano da soli.
import { createHmac } from "node:crypto";

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

export function otaLabel(channel?: string): string {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("booking")) return "Booking.com";
  if (c.includes("airbnb")) return "Airbnb";
  if (c.includes("expedia") || c.includes("vrbo")) return "Expedia";
  return "OTA";
}

export type AppendResult =
  | { status: "added"; guestId: string; channel: string }
  | { status: "duplicate" }
  | { status: "no_booking" };

/** Aggiunge il messaggio al thread dell'ospite dentro il blob di stato (modifica `blob` sul posto). Idempotente sull'id del messaggio. */
export function appendOtaMessage(blob: Record<string, string>, msg: InboundOtaMessage, now: number): AppendResult {
  let data: { bookings?: { extId?: string; guestId?: string; channel?: string }[] } = {};
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
  return { status: "added", guestId: booking.guestId, channel: otaLabel(booking.channel) };
}

/** Segreto condiviso con Channex (intestazione del webhook), derivato da un segreto già presente su Vercel. Vuoto se non disponibile. */
export function messageHookSecret(env: Record<string, string | undefined> = process.env): string {
  const base = env.CRON_SECRET || env.CRED_SECRET || "";
  return base ? createHmac("sha256", base).update("channex-message-webhook").digest("hex") : "";
}
