// Media (foto, firme, PDF) su Supabase Storage invece che dentro i dati JSON.
//
// MODULO PURO (nessun I/O, nessun import): usabile da browser, server e test.
//
// Nei dati (guests, bookings, units, sito…) al posto della data URI si salva un RIFERIMENTO testuale breve:
//     media:<bucket>:<percorso>          es.  media:xenora-public:u/<tenantId>/<uuid>.jpg
// Chi legge un'immagine deve accettare ENTRAMBI i formati (data URI vecchia, riferimento nuovo): vedi media-client.ts
// (resolveMediaUrl) e components/MediaImg.tsx.
//
// Due bucket:
//   - xenora-public  PUBBLICO: foto camere, immagini del sito. L'URL pubblico è deducibile dal riferimento (publicUrlOf).
//   - xenora-private PRIVATO: documenti d'identità, firme. Si legge solo con un URL firmato chiesto a /api/media.
//
// Percorso: <scope>/<id>/<uuid>.<ext>  con scope "u" (id = utente/tenant titolare) oppure "o" (id = organizzazione condivisa).
// L'autorizzazione dei file privati si basa SOLO su questo percorso (canAccessPath).

export const PUBLIC_BUCKET = "xenora-public";
export const PRIVATE_BUCKET = "xenora-private";
export type MediaBucket = typeof PUBLIC_BUCKET | typeof PRIVATE_BUCKET;
export type MediaVisibility = "public" | "private";
export type MediaScope = "u" | "o";

export const bucketOf = (v: MediaVisibility): MediaBucket => (v === "public" ? PUBLIC_BUCKET : PRIVATE_BUCKET);
export const visibilityOf = (b: MediaBucket): MediaVisibility => (b === PUBLIC_BUCKET ? "public" : "private");

/** Limite per file: le route di Vercel accettano ~4,5 MB di corpo, restiamo sotto. Le foto si riducono lato client prima dell'invio. */
export const MEDIA_MAX_BYTES = 4 * 1024 * 1024;
/** Lato massimo e qualità JPEG della riduzione lato client. */
export const MEDIA_MAX_SIDE = 1600;
export const MEDIA_JPEG_QUALITY = 0.72;

/** Tipi ammessi (mime → estensione). Il pubblico accetta solo immagini; il privato anche PDF. */
export const IMAGE_MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
export const PRIVATE_MIME_EXT: Record<string, string> = { ...IMAGE_MIME_EXT, "application/pdf": "pdf" };
export const allowedMimes = (v: MediaVisibility): Record<string, string> => (v === "public" ? IMAGE_MIME_EXT : PRIVATE_MIME_EXT);
const ALL_EXT = "jpg|png|webp|gif|pdf";

export const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" };

// ---- UUID --------------------------------------------------------------------------------------------------------------
export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** UUID v4 (crypto.randomUUID quando c'è; altrimenti un ripiego, perché l'id deve SEMPRE essere un UUID valido). */
export function newUuid(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- Percorsi ------------------------------------------------------------------------------------------------------------
/** Percorso nel bucket: <scope>/<id>/<uuid>.<ext>. `id` deve essere un UUID (tenant o organizzazione). */
export function scopedPath(scope: MediaScope, id: string, ext: string, fileId: string = newUuid()): string {
  if (scope !== "u" && scope !== "o") throw new Error("scope non valido");
  if (!isUuid(id)) throw new Error("id non valido");
  if (!isUuid(fileId)) throw new Error("fileId non valido");
  const e = ext.toLowerCase().replace(/^\./, "");
  if (!new RegExp(`^(${ALL_EXT})$`).test(e)) throw new Error("estensione non ammessa");
  return `${scope}/${id.toLowerCase()}/${fileId.toLowerCase()}.${e}`;
}

export interface ParsedPath { scope: MediaScope; id: string; fileId: string; ext: string }
/** Percorso ben formato? (rifiuta "..", slash extra, nomi non UUID, estensioni strane.) */
export function parsePath(path: unknown): ParsedPath | null {
  if (typeof path !== "string") return null;
  const m = path.match(new RegExp(`^(u|o)/([0-9a-f-]{36})/([0-9a-f-]{36})\\.(${ALL_EXT})$`, "i"));
  if (!m || !isUuid(m[2]) || !isUuid(m[3])) return null;
  return { scope: m[1] as MediaScope, id: m[2].toLowerCase(), fileId: m[3].toLowerCase(), ext: m[4].toLowerCase() };
}

/** Il chiamante può leggere/togliere questo file? scope u: id = suo tenant; scope o: id tra le sue organizzazioni (attive). */
export function canAccessPath(path: unknown, who: { tenantId?: string | null; orgIds?: readonly string[] | null }): boolean {
  const p = parsePath(path);
  if (!p) return false;
  if (p.scope === "u") return !!who.tenantId && who.tenantId.toLowerCase() === p.id;
  return (who.orgIds ?? []).some((o) => typeof o === "string" && o.toLowerCase() === p.id);
}

// ---- Riferimenti ---------------------------------------------------------------------------------------------------------
const REF_PREFIX = "media:";

/** Riferimento testuale da salvare nei dati. Il percorso viene validato. */
export function mediaRef(bucket: MediaBucket, path: string): string {
  if (bucket !== PUBLIC_BUCKET && bucket !== PRIVATE_BUCKET) throw new Error("bucket non valido");
  if (!parsePath(path)) throw new Error("percorso non valido");
  return `${REF_PREFIX}${bucket}:${path}`;
}

export interface ParsedRef { bucket: MediaBucket; path: string; visibility: MediaVisibility; parsed: ParsedPath }
/** Riferimento ben formato → parti; altrimenti null (anche per URL, data URI, stringhe qualunque). */
export function parseMediaRef(s: unknown): ParsedRef | null {
  if (typeof s !== "string" || !s.startsWith(REF_PREFIX) || s.length > 200) return null;
  const rest = s.slice(REF_PREFIX.length);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  const bucket = rest.slice(0, i);
  const path = rest.slice(i + 1);
  if (bucket !== PUBLIC_BUCKET && bucket !== PRIVATE_BUCKET) return null;
  const parsed = parsePath(path);
  if (!parsed) return null;
  return { bucket: bucket as MediaBucket, path, visibility: visibilityOf(bucket as MediaBucket), parsed };
}
export const isMediaRef = (s: unknown): s is string => parseMediaRef(s) !== null;
export const isPublicRef = (s: unknown): s is string => parseMediaRef(s)?.visibility === "public";
export const isPrivateRef = (s: unknown): s is string => parseMediaRef(s)?.visibility === "private";

/** Data URI (immagine o PDF)? Basta il prefisso: serve a riconoscere i dati VECCHI da migrare. */
export const isDataUri = (s: unknown): s is string => typeof s === "string" && /^data:/i.test(s);
/** Data URI di un'immagine o di un PDF (quello che la migrazione sposta su Storage). */
export const isInlineMedia = (s: unknown): s is string => typeof s === "string" && (/^data:image\//i.test(s) || /^data:application\/pdf/i.test(s));

/** URL pubblico assoluto di un riferimento PUBBLICO (null per privati, riferimenti non validi o URL Supabase non configurato). */
export function publicUrlOf(ref: unknown, supabaseUrl?: string | null): string | null {
  const p = parseMediaRef(ref);
  if (!p || p.visibility !== "public") return null;
  const base = (supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${p.bucket}/${p.path}`;
}

// ---- Data URI → byte -----------------------------------------------------------------------------------------------------
/** Decodifica una data URI base64 in { mime, bytes }. null se non è base64 valida. */
export function parseDataUri(s: unknown): { mime: string; bytes: Uint8Array } | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^data:([a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*)((?:;[a-z0-9-]+=[^;,]*)*);base64,([A-Za-z0-9+/=\s_-]*)$/i);
  if (!m) return null;
  try {
    const bin = atob(m[3].replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1].toLowerCase(), bytes };
  } catch { return null; }
}

// ---- Tipo reale dai byte -------------------------------------------------------------------------------------------------
/** Tipo reale del file dai primi byte (non ci si fida del tipo dichiarato dal browser). null se non riconosciuto. */
export function sniffMediaType(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  return null;
}

export type UploadCheck = { ok: true; mime: string; ext: string } | { ok: false; error: string };

/**
 * Validazione completa di un upload (logica della route POST /api/media): tipo dichiarato ammesso per la visibilità,
 * dimensione entro il limite e tipo REALE dei byte uguale a quello dichiarato.
 */
export function checkUpload(opts: { visibility: MediaVisibility; declaredType?: string | null; bytes: Uint8Array }): UploadCheck {
  const declared = (opts.declaredType || "").toLowerCase().split(";")[0].trim();
  const table = allowedMimes(opts.visibility);
  const ext = table[declared];
  if (!ext) return { ok: false, error: opts.visibility === "public" ? "Formato non ammesso: usa una foto (JPG, PNG, WebP, GIF)." : "Formato non ammesso: usa una foto (JPG, PNG, WebP, GIF) o un PDF." };
  if (!opts.bytes.length) return { ok: false, error: "Il file è vuoto." };
  if (opts.bytes.length > MEDIA_MAX_BYTES) return { ok: false, error: `Il file è troppo grande (massimo ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB).` };
  const real = sniffMediaType(opts.bytes);
  if (!real || real !== declared) return { ok: false, error: "Il contenuto del file non corrisponde al formato." };
  return { ok: true, mime: real, ext };
}

/** Durata dell'URL firmato dei file privati (secondi) e tempo di cache lato client (ms, un po' meno per non servire URL scaduti). */
export const SIGNED_URL_SECONDS = 300;
export const SIGNED_URL_CLIENT_CACHE_MS = 4 * 60 * 1000;

// ---- Logica pura della route /api/media ---------------------------------------------------------------------------------
export interface MediaWho { tenantId?: string | null; orgIds?: readonly string[] | null }

/** Dove salvare un upload: sotto l'organizzazione (se richiesta e il chiamante ne è membro) altrimenti sotto il tenant. */
export function uploadTarget(who: MediaWho, orgId?: string | null): { ok: true; scope: MediaScope; id: string } | { ok: false; error: string } {
  const o = (orgId || "").trim();
  if (o) {
    if (!isUuid(o) || !(who.orgIds ?? []).some((x) => typeof x === "string" && x.toLowerCase() === o.toLowerCase())) return { ok: false, error: "Non fai parte di questa organizzazione." };
    return { ok: true, scope: "o", id: o.toLowerCase() };
  }
  if (!who.tenantId || !isUuid(who.tenantId)) return { ok: false, error: "Account non valido." };
  return { ok: true, scope: "u", id: who.tenantId.toLowerCase() };
}

/** Riferimento ricevuto da GET/DELETE: ben formato E consentito al chiamante? (Per GET dei pubblici non serve l'accesso: l'URL è pubblico.) */
export function authorizeRef(ref: unknown, who: MediaWho, op: "read" | "delete"): { ok: true; ref: ParsedRef } | { ok: false; status: 400 | 403; error: string } {
  const p = parseMediaRef(ref);
  if (!p) return { ok: false, status: 400, error: "Riferimento non valido." };
  if (op === "read" && p.visibility === "public") return { ok: true, ref: p };
  if (!canAccessPath(p.path, who)) return { ok: false, status: 403, error: "Non hai accesso a questo file." };
  return { ok: true, ref: p };
}

// ---- Utilità per leggere/mostrare ----------------------------------------------------------------------------------------
/** Dimensioni ridotte in modo che il lato lungo non superi `max` (mai ingrandisce). Interi >= 1. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: Math.max(1, Math.round(w) || 1), height: Math.max(1, Math.round(h) || 1) };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/**
 * URL utilizzabile da un servizio ESTERNO (Channex, Google, email, og:image…): riferimento pubblico → URL pubblico assoluto,
 * http(s) invariato, tutto il resto (data URI, riferimento privato, stringa vuota) → null.
 */
export function toExternalUrl(src: unknown, supabaseUrl?: string | null): string | null {
  if (typeof src !== "string" || !src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  return publicUrlOf(src, supabaseUrl);
}
