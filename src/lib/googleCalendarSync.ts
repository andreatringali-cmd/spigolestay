import crypto from "node:crypto";

// Sync in tempo reale con Google Calendar: invece di far leggere a Google un feed iCal
// (che lui ricontrolla quando vuole, anche dopo ore — vedi calendar-feed.ts), scriviamo
// noi direttamente l'evento via Calendar API v3 ogni volta che una prenotazione cambia.
// Riusa lo STESSO service account già configurato per Google Wallet (GOOGLE_WALLET_*):
// un service account è una semplice identità, può chiamare API diverse (Wallet, Calendar…)
// — qui serve solo che l'API Calendar sia abilitata sullo stesso progetto Google Cloud.
// L'utente condivide il SUO calendario con l'email del service account (permesso "Apportare
// modifiche agli eventi"): da quel momento possiamo scrivere/cancellare eventi su quel
// calendario senza alcun consenso OAuth per-utente.
// Gating: senza le env, configured() torna false e le funzioni non fanno nulla (mai eccezione).

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function privateKeyPem(): string {
  const raw = process.env.GOOGLE_WALLET_PRIVATE_KEY || "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function serviceAccountEmail(): string {
  return process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL || "";
}

export function gcalSyncConfigured(): boolean {
  return !!(serviceAccountEmail() && privateKeyPem());
}

export function gcalServiceAccountEmail(): string | null {
  return gcalSyncConfigured() ? serviceAccountEmail() : null;
}

// Token OAuth2 cache in memoria di modulo: valido per il resto di vita dell'istanza
// serverless (warm start), evita una richiesta di token ad ogni singola chiamata.
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.exp > Date.now() + 30_000) return cachedToken.token;
  const email = serviceAccountEmail();
  const pem = privateKeyPem();
  if (!email || !pem) return null;
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
      iss: email,
      scope: "https://www.googleapis.com/auth/calendar.events",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(pem);
    const assertion = `${signingInput}.${base64url(signature)}`;

    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!j?.access_token) return null;
    cachedToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return cachedToken.token;
  } catch { return null; }
}

// L'id evento Calendar deve rispettare ^[a-v0-9]{5,1024}$ (base32hex, minuscolo, niente
// trattini): un UUID senza trattini è esadecimale (0-9a-f), sottoinsieme valido di a-v0-9.
export function gcalEventId(bookingId: string): string {
  return bookingId.replace(/-/g, "").toLowerCase().slice(0, 1024) || "booking";
}

export interface GcalEventInput {
  calendarId: string;
  eventId: string;
  summary: string;
  description?: string;
  startDate: string; // ISO yyyy-mm-dd (evento "tutto il giorno")
  endDateExclusive: string; // ISO yyyy-mm-dd, esclusivo (come richiede Calendar per gli eventi "tutto il giorno")
}

async function callCalendar(path: string, method: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

// Crea o aggiorna l'evento (idempotente sull'id derivato dalla prenotazione).
export async function upsertGcalEvent(input: GcalEventInput): Promise<{ ok: boolean; error?: string }> {
  if (!gcalSyncConfigured()) return { ok: false, error: "not_configured" };
  const calendarId = input.calendarId.trim();
  if (!calendarId) return { ok: false, error: "missing_calendar_id" };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "auth_failed" };
  const body = {
    summary: input.summary,
    description: input.description,
    start: { date: input.startDate },
    end: { date: input.endDateExclusive },
  };
  try {
    // Prova prima l'aggiornamento (evento già esistente); se non c'è ancora, lo crea con quell'id.
    const upd = await callCalendar(`calendars/${encodeURIComponent(calendarId)}/events/${input.eventId}`, "PATCH", token, body);
    if (upd.ok) return { ok: true };
    if (upd.status !== 404) return { ok: false, error: `http_${upd.status}` };
    const ins = await callCalendar(`calendars/${encodeURIComponent(calendarId)}/events`, "POST", token, { id: input.eventId, ...body });
    if (ins.ok) return { ok: true };
    return { ok: false, error: `http_${ins.status}` };
  } catch { return { ok: false, error: "fetch_failed" }; }
}

export async function deleteGcalEvent(calendarId: string, eventId: string): Promise<{ ok: boolean; error?: string }> {
  if (!gcalSyncConfigured()) return { ok: false, error: "not_configured" };
  const cid = calendarId.trim();
  if (!cid) return { ok: false, error: "missing_calendar_id" };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "auth_failed" };
  try {
    const r = await callCalendar(`calendars/${encodeURIComponent(cid)}/events/${eventId}`, "DELETE", token);
    // 404/410/204: l'evento non c'è (più) — risultato comunque raggiunto, idempotente.
    if (r.ok || r.status === 404 || r.status === 410) return { ok: true };
    return { ok: false, error: `http_${r.status}` };
  } catch { return { ok: false, error: "fetch_failed" }; }
}
