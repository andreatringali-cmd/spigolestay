// Messaggi degli ospiti dalle OTA (Booking.com, Airbnb, Expedia) in arrivo da Channex col webhook "message".
// Moduli puri (nessun accesso a rete/DB): il webhook li usa e i test li provano da soli.
import { createHmac, timingSafeEqual } from "node:crypto";

const DATA_KEY = "spigolestay:data:v1";
const THREADS_KEY = "spigolestay:threads:v1";

/** Allegato di un messaggio OTA: teniamo solo l'indirizzo e il nome (il file resta su Channex, non viene scaricato né salvato). */
export interface OtaAttachment { url: string; name?: string }
/** `sender` "guest" = scritto dall'ospite; "property" = scritto dalla struttura FUORI da Xenora (extranet, Booking Pulse…). `ts` = orario del messaggio (ms) se Channex lo manda. */
export interface InboundOtaMessage { id: string; text: string; bookingId: string; propertyId: string; sender: "guest" | "property"; ts?: number; attachments?: OtaAttachment[] }
type Thread = { id: string; dir: "in" | "out"; text: string; ts: number; via?: string; att?: OtaAttachment[] }[];
type DataObj = Record<string, unknown>;

/** Base dell'API Channex (stessa variabile di channex.ts); serve a completare gli URL relativi degli allegati. */
export function channexApiBase(env: Record<string, string | undefined> = process.env): string {
  return env.CHANNEX_API_URL || "https://staging.channex.io/api/v1";
}

/**
 * Normalizza gli allegati di un messaggio Channex. La documentazione dice solo "lista di link" e che gli URL possono essere
 * RELATIVI (da completare con https://app.channex.io/api/v1/ in produzione, https://staging.channex.io/api/v1/ in staging):
 * accettiamo sia stringhe sia oggetti ({url|href|link|path, name|file_name|filename}). Solo http(s), senza doppioni, al massimo 10.
 */
export function parseAttachments(raw: unknown, apiBase: string): OtaAttachment[] {
  if (!Array.isArray(raw)) return [];
  const base = apiBase.replace(/\/+$/, "");
  const origin = (() => { try { return new URL(base).origin; } catch { return ""; } })();
  const out: OtaAttachment[] = [];
  for (const item of raw) {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const rawUrl = typeof item === "string" ? item : String(o?.url ?? o?.href ?? o?.link ?? o?.path ?? "");
    const u = rawUrl.trim();
    if (!u) continue;
    let url = "";
    if (/^https?:\/\//i.test(u)) url = u;
    else if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//")) continue; // javascript:, data:, … non sono link da mostrare
    else if (/^\/?api\/v\d+\//i.test(u)) url = origin ? `${origin}/${u.replace(/^\//, "")}` : ""; // già col prefisso /api/v1
    else url = `${base}/${u.replace(/^\/+/, "")}`;
    if (!url || out.some((a) => a.url === url)) continue;
    let name = String(o?.name ?? o?.file_name ?? o?.filename ?? "").trim();
    if (!name) {
      try { name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? ""); } catch { name = ""; }
    }
    out.push(name ? { url, name: name.slice(0, 120) } : { url });
    if (out.length >= 10) break;
  }
  return out;
}

/** Orario di Channex ("2021-07-28T04:25:15.000000", senza fuso: è UTC) in millisecondi; undefined se assente o non valido. */
export function parseChannexTime(v: unknown): number | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const s = v.trim();
  const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : undefined;
}

/** Testo confrontabile: senza spazi ai bordi e con gli spazi interni compressi. */
export const normText = (t: string): string => t.replace(/\s+/g, " ").trim();

/** Estrae il messaggio dal corpo del webhook (dell'ospite o della struttura); null se non c'è nulla da mostrare. */
export function parseChannexMessage(body: unknown, apiBase: string = channexApiBase()): InboundOtaMessage | null {
  const b = (body ?? {}) as { event?: string; property_id?: string; payload?: Record<string, unknown> };
  if (b.event !== "message") return null;
  const p = b.payload ?? {};
  const sender = p.sender;
  if (sender !== "guest" && sender !== "property") return null;
  const id = String(p.id ?? p.ota_message_id ?? "").trim();
  const bookingId = String(p.booking_id ?? "").trim();
  const propertyId = String(p.property_id ?? b.property_id ?? "").trim();
  if (!id || !bookingId || !propertyId) return null;
  const raw = typeof p.message === "string" ? p.message.trim() : "";
  const attachments = parseAttachments(p.attachments, apiBase);
  // Solo allegato: testo segnaposto. Con gli indirizzi l'allegato si apre dalla chat; senza (formato non riconosciuto) rimanda all'OTA.
  const text = raw || (attachments.length ? "📎 Allegato" : p.have_attachment ? "📎 Allegato (aprilo su Booking.com, Airbnb o Expedia)" : "");
  if (!text) return null;
  const ts = parseChannexTime(p.inserted_at);
  return { id, text, bookingId, propertyId, sender, ...(ts !== undefined ? { ts } : {}), ...(attachments.length ? { attachments } : {}) };
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

type BookingRef = { id?: string; extId?: string; guestId?: string; channel?: string };

/** Riga di channex_map che interessa ai messaggi: chi ha collegato la property e l'eventuale organizzazione (struttura condivisa). */
export interface MessageMapRow { tenant_id?: string | null; org_id?: string | null }

/**
 * Sceglie la riga di channex_map della property. Se ce n'è più d'una preferisce quella di una struttura condivisa (org_id),
 * perché è lì che vive la prenotazione. Il thread si scrive SEMPRE nello stato personale (app_state) di chi ha collegato la property:
 * la chiave dei thread non è divisa per organizzazione (vedi splitByOrg in authsync.tsx), solo prenotazioni/ospiti/strutture lo sono.
 * `orgId` dice dove cercare anche la prenotazione (org_state), oltre al blob personale.
 */
export function pickMessageStore(rows: MessageMapRow[] | null | undefined): { tenantId: string; orgId: string | null } | null {
  const ok = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.tenant_id === "string" && r.tenant_id);
  const row = ok.find((r) => r.org_id) ?? ok[0];
  return row ? { tenantId: String(row.tenant_id), orgId: row.org_id ? String(row.org_id) : null } : null;
}

/** Finestra entro cui una risposta della struttura è considerata la stessa già registrata da Xenora (id diverso, stesso testo). */
export const OUT_DEDUP_MS = 10 * 60 * 1000;

/** True se nel thread c'è già un messaggio "out" con lo stesso testo normalizzato e orario entro 10 minuti (risposta inviata da Xenora e poi riletta da Channex). */
export function hasSameOut(list: { dir: string; text: string; ts: number }[], text: string, ts: number): boolean {
  const n = normText(text);
  return list.some((m) => m.dir === "out" && normText(m.text ?? "") === n && Math.abs(m.ts - ts) <= OUT_DEDUP_MS);
}

/** Aggiunge il messaggio al thread dell'ospite dentro il blob di stato (modifica `blob` sul posto). Idempotente sull'id del messaggio.
 *  La prenotazione si cerca nei dati delle organizzazioni (`orgDatas`, già parsificati: org_state) e poi nel blob personale: le strutture condivise vivono solo in org_state. */
export function appendOtaMessage(blob: Record<string, string>, msg: InboundOtaMessage, now: number, orgDatas: DataObj[] = []): AppendResult {
  let data: DataObj = {};
  try { data = JSON.parse(blob[DATA_KEY] || "{}"); } catch { data = {}; }
  const extId = `channex:${msg.bookingId}`;
  const find = (d: DataObj) => (Array.isArray(d.bookings) ? (d.bookings as BookingRef[]) : []).find((x) => x?.extId === extId && x.guestId);
  const booking = orgDatas.map(find).find(Boolean) ?? find(data);
  if (!booking?.guestId) return { status: "no_booking" };
  let threads: Record<string, Thread> = {};
  try { threads = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { threads = {}; }
  const mid = `chx:${msg.id}`;
  const list = threads[booking.guestId] ?? [];
  if (list.some((m) => m.id === mid)) return { status: "duplicate" };
  const dir = msg.sender === "property" ? "out" : "in";
  const ts = dir === "out" ? (msg.ts ?? now) : now;
  if (dir === "out" && hasSameOut(list, msg.text, ts)) return { status: "duplicate" };
  threads[booking.guestId] = [...list, { id: mid, dir, text: msg.text, ts, via: otaLabel(booking.channel), ...(msg.attachments?.length ? { att: msg.attachments } : {}) }];
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
