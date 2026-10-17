// Sync con Google Calendar (e qualsiasi altro calendario che sa leggere un feed iCal
// "Aggiungi da URL"): due feed pubblici per tenant, protetti da un token firmato invece
// che da login (Google Calendar interroga l'URL da solo, senza sessione utente).
// - "bookings": un evento per prenotazione (check-in → check-out).
// - "pulizie": un evento per ogni giorno di check-out/turnover, per la signora delle pulizie.
// Stesso pattern di firma HMAC già usato per lo state OAuth di Fatture in Cloud (fic-oauth.ts).

import { createHmac, timingSafeEqual } from "crypto";
import { DATA_KEY } from "@/lib/manage-booking";
import { warnFallbackOnce } from "@/lib/warn-fallback";
import { addDaysYmd, todayRome } from "@/lib/dates-rome";
import { CHANNELS, type Channel } from "@/lib/types";

export type FeedKind = "bookings" | "pulizie";

function feedSecret(): string {
  if (process.env.CRED_SECRET) return process.env.CRED_SECRET;
  warnFallbackOnce("CRED_SECRET(calendar-feed)", "I feed calendario sono firmati con un segreto noto: imposta CRED_SECRET (cambiarla poi invalida i link già condivisi).");
  return "xenora-calendar-feed";
}

function b64url(buf: Buffer): string { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

export function signFeedToken(tenantId: string, kind: FeedKind): string {
  return b64url(createHmac("sha256", feedSecret()).update(`${tenantId}:${kind}`).digest()).slice(0, 32);
}

export function verifyFeedToken(tenantId: string, kind: FeedKind, token: string): boolean {
  if (!token) return false;
  const expected = signFeedToken(tenantId, kind);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function feedUrl(baseUrl: string, tenantId: string, kind: FeedKind): string {
  const t = signFeedToken(tenantId, kind);
  return `${baseUrl}/api/calendar/feed?u=${encodeURIComponent(tenantId)}&k=${kind}&t=${t}`;
}

// ── Costruzione iCal (RFC 5545) ──
type Json = Record<string, unknown>;
export interface IcsEvent { uid: string; startISO: string; endISO: string; summary: string; description?: string }

const escText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
// Piega le righe oltre 75 ottetti come richiesto dalla spec (continuazione con spazio iniziale).
// Il limite è in OTTETTI (byte UTF-8), non in caratteri: si taglia per punti di codice interi, così non si spezzano
// né le coppie surrogate (emoji) né le sequenze UTF-8 multibyte (lettere accentate, "🧹").
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "", curBytes = 0, limit = 75; // la prima riga ha 75 ottetti; le continuazioni 74 + lo spazio iniziale
  for (const ch of line) { // for…of itera per punti di codice: una coppia surrogata è un solo elemento
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) { parts.push(cur); cur = ""; curBytes = 0; limit = 74; }
    cur += ch; curBytes += b;
  }
  if (cur) parts.push(cur);
  return parts.map((p, i) => (i === 0 ? p : " " + p)).join("\r\n");
}
const dstamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

export function buildIcs(calName: string, events: IcsEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Xenora//Calendar Feed//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escText(calName)}`,
  ];
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${dstamp()}`,
      `DTSTART;VALUE=DATE:${ymd(ev.startISO)}`,
      `DTEND;VALUE=DATE:${ymd(ev.endISO)}`,
      `SUMMARY:${escText(ev.summary)}`,
    );
    if (ev.description) lines.push(`DESCRIPTION:${escText(ev.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ── Estrazione eventi dal blob dati del tenant (stesso formato di manage-booking.ts) ──
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function parseTenantBlob(data: unknown): Json {
  const blob = ((data ?? {}) as Record<string, string>) || {};
  try { return JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { return {}; }
}

// Feed "Prenotazioni": un evento per soggiorno (check-in → check-out), esclude cancellate.
export function bookingEvents(data: Json): IcsEvent[] {
  const bookings = arr(data.bookings);
  const structures = arr(data.structures);
  const guests = arr(data.guests);
  const units = arr(data.units);
  const cutoffISO = addDaysYmd(todayRome(), -60); // giorno di calendario italiano, indipendente dal fuso del server
  const out: IcsEvent[] = [];
  for (const b of bookings) {
    const status = s(b.status);
    const checkIn = s(b.checkIn), checkOut = s(b.checkOut);
    if (s(b.channel) === "blocked") continue; // un blocco camera non è un ospite: non va nel calendario
    if (status === "cancelled" || !isDate(checkIn) || !isDate(checkOut) || checkOut < cutoffISO) continue;
    const st = structures.find((x) => x.id === b.structureId);
    const guest = guests.find((x) => x.id === b.guestId);
    const unit = units.find((x) => x.id === b.unitId);
    const guestName = s(guest?.fullName) || "Ospite";
    const structureName = s(st?.name) || "";
    const roomLabel = s(unit?.name) || "";
    const summary = [guestName, [structureName, roomLabel].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
    const descParts = [s(b.code) && `Codice: ${s(b.code)}`, s(b.channel) && `Canale: ${CHANNELS[s(b.channel) as Channel]?.label ?? s(b.channel)}`, `Ospiti: ${Number(b.adults) || 1}${Number(b.children) ? "+" + Number(b.children) : ""}`].filter(Boolean);
    out.push({ uid: `booking-${s(b.id)}@xenora.it`, startISO: checkIn, endISO: checkOut, summary, description: descParts.join(" · ") });
  }
  return out;
}

// Feed "Pulizie": un evento per (unità, giorno di check-out), segnalando se è anche
// giorno di arrivo (turnover, priorità alta per la signora delle pulizie).
export function pulizieEvents(data: Json): IcsEvent[] {
  // I blocchi camera (channel "blocked") non sono ospiti: niente turnover né pulizia per loro.
  const bookings = arr(data.bookings).filter((b) => s(b.status) !== "cancelled" && s(b.channel) !== "blocked" && isDate(s(b.checkIn)) && isDate(s(b.checkOut)));
  const structures = arr(data.structures);
  const units = arr(data.units);
  const cutoffISO = addDaysYmd(todayRome(), -60);

  const byUnitDate = new Map<string, { unitId: string; date: string; departure: boolean; arrival: boolean }>();
  for (const b of bookings) {
    const unitId = s(b.unitId); if (!unitId) continue;
    const dep = s(b.checkOut), arrDate = s(b.checkIn);
    if (dep >= cutoffISO) {
      const k = `${unitId}|${dep}`;
      const row = byUnitDate.get(k) ?? { unitId, date: dep, departure: false, arrival: false };
      row.departure = true; byUnitDate.set(k, row);
    }
    if (arrDate >= cutoffISO) {
      const k = `${unitId}|${arrDate}`;
      const row = byUnitDate.get(k) ?? { unitId, date: arrDate, departure: false, arrival: false };
      row.arrival = true; byUnitDate.set(k, row);
    }
  }

  const out: IcsEvent[] = [];
  for (const row of byUnitDate.values()) {
    if (!row.departure) continue; // si pulisce il giorno di partenza (anche se turnover)
    const unit = units.find((x) => x.id === row.unitId);
    const st = structures.find((x) => x.id === unit?.structureId);
    const unitName = s(unit?.name) || "camera";
    const structureName = s(st?.name) || "";
    const kind = row.arrival ? "turnover (partenza + arrivo)" : "partenza";
    out.push({
      uid: `pulizie-${row.unitId}-${row.date}@xenora.it`,
      startISO: row.date,
      endISO: addDaysYmd(row.date, 1), // aritmetica di calendario: non dipende dal fuso del server né dall'ora legale
      summary: `🧹 Pulizia ${[structureName, unitName].filter(Boolean).join(" ")} — ${kind}`,
    });
  }
  return out;
}
