// Allegati del check-in online (foto documento, firma) su Supabase Storage — logica PURA e testabile.
//
// Il check-in lo compila l'ospite ANONIMO dal link: non può chiamare /api/media (serve un bearer). Quindi:
//   1. ogni file viene caricato UNO PER VOLTA su POST /api/checkin/upload (slug + id prenotazione), che lo valida (checkUpload sul
//      contenuto reale), lo salva nel bucket PRIVATO con putMedia e restituisce { ref, token };
//   2. il POST finale /api/checkin riceve solo i RIFERIMENTI (+ la mappa dei token) e li accetta solo se
//        - appartengono al proprietario di quella prenotazione (stesso scope/id: utente o organizzazione), E
//        - sono già presenti nella prenotazione/anagrafica (l'operatore che riapre il check-in) oppure portano un token valido.
//      Il token è un HMAC (id prenotazione + riferimento + scadenza) firmato col segreto del server: prova che quel file è stato
//      caricato proprio per QUESTA prenotazione tramite l'endpoint di upload. Nessun percorso viene mai accettato dal client.
//   3. Per compatibilità con le pagine vecchie in cache, il POST finale accetta ancora poche data URI e le carica lui.
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  MEDIA_MAX_BYTES, PRIVATE_BUCKET, checkUpload, parseDataUri, parseMediaRef, isDataUri, type MediaScope,
} from "./media";

export const MAX_EXTRA_GUESTS = 30;
/** Allegati (riferimenti + eventuali data URI) in una singola richiesta di check-in. */
export const MAX_ATTACHMENTS_PER_REQUEST = 70;
/** Data URI accettate direttamente nel POST finale (solo compatibilità con pagine vecchie). */
export const MAX_INLINE_UPLOADS = 6;
export const UPLOAD_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export type AttachmentKind = "photo" | "signature";
const KIND_MIMES: Record<AttachmentKind, readonly string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  signature: ["image/png", "image/jpeg", "image/webp"],
};

export class AttachmentError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

// ---- Dove vivono i file di una prenotazione ------------------------------------------------------------------------------
export interface StoreLike { table: "app_state" | "org_state"; keyVal: string }
export interface MediaTarget { scope: MediaScope; id: string }

/** Struttura in un'org condivisa (org_state) → scope "o" con l'id dell'org; struttura personale (app_state) → scope "u" col proprietario. */
export function storeMediaTarget(store: StoreLike): MediaTarget {
  return store.table === "org_state" ? { scope: "o", id: store.keyVal.toLowerCase() } : { scope: "u", id: store.keyVal.toLowerCase() };
}

/** Chi sta guardando può vedere i documenti di questo store? (proprietario/collaboratore dello stato personale, o socio dell'org.) */
export function canViewStore(store: StoreLike, who: { tenantId?: string | null; userId?: string | null; orgIds?: readonly string[] | null }): boolean {
  const key = store.keyVal.toLowerCase();
  if (store.table === "app_state") return [who.tenantId, who.userId].some((x) => typeof x === "string" && x.toLowerCase() === key);
  return (who.orgIds ?? []).some((o) => typeof o === "string" && o.toLowerCase() === key);
}

// ---- Token ---------------------------------------------------------------------------------------------------------------
const macOf = (secret: string, bookingId: string, ref: string, exp: number) =>
  createHmac("sha256", secret).update(`checkin-media|${bookingId}|${ref}|${exp}`).digest("hex");

export function signUploadToken(secret: string, bookingId: string, ref: string, now: number = Date.now()): string {
  const exp = now + UPLOAD_TOKEN_TTL_MS;
  return `${exp}.${macOf(secret, bookingId, ref, exp)}`;
}

export function verifyUploadToken(secret: string, bookingId: string, ref: string, token: unknown, now: number = Date.now()): boolean {
  if (!secret || typeof token !== "string" || token.length > 200) return false;
  const m = token.match(/^([0-9]{10,16})[.]([0-9a-f]{64})$/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp < now) return false;
  const a = Buffer.from(m[2], "hex");
  const b = Buffer.from(macOf(secret, bookingId, ref, exp), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Segreto per i token: variabile dedicata se c'è, altrimenti un segreto già presente sul server (mai esposto). */
export function uploadSecret(): string {
  return process.env.CHECKIN_UPLOAD_SECRET || process.env.CRED_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

// ---- Validazione di un file ----------------------------------------------------------------------------------------------
/** Validazione di UN allegato del check-in: tipo reale (dai byte) ammesso per quel tipo di allegato, non vuoto, entro il limite. */
export function validateCheckinFile(kind: AttachmentKind, declaredType: string | null | undefined, bytes: Uint8Array): { ok: true; mime: string } | { ok: false; error: string } {
  const declared = (declaredType || "").toLowerCase().split(";")[0].trim();
  if (!KIND_MIMES[kind].includes(declared)) return { ok: false, error: kind === "signature" ? "La firma deve essere un'immagine." : "Formato non ammesso: usa una foto (JPG, PNG, WebP) o un PDF." };
  const c = checkUpload({ visibility: "private", declaredType: declared, bytes });
  return c.ok ? { ok: true, mime: c.mime } : { ok: false, error: c.error };
}

// ---- Risoluzione degli allegati di una richiesta ---------------------------------------------------------------------------
export interface ResolverCtx {
  bookingId: string;
  target: MediaTarget;
  /** Riferimenti privati già presenti nella prenotazione e nell'anagrafica ospite (si possono riconfermare senza token). */
  allowed: ReadonlySet<string>;
  /** Mappa riferimento → token ricevuta dal client. */
  tokens: Record<string, unknown>;
  secret: string;
  /** Salva i byte nel bucket privato (nella route: putMedia con il client admin) e restituisce il riferimento. */
  put: (bytes: Uint8Array, mime: string) => Promise<string>;
  now?: number;
}

/**
 * Risolve i valori che il client manda per foto/firma: data URI → caricata (poche) e sostituita dal riferimento; riferimento →
 * accettato solo se privato, dello stesso proprietario e già presente oppure con token valido; vuoto → undefined (= non cambiare).
 * Qualunque altra cosa (URL, riferimento pubblico o di altri, file non valido) → AttachmentError.
 */
export function createAttachmentResolver(ctx: ResolverCtx) {
  const uploadedNow: string[] = [];
  const memo = new Map<string, string>();
  let count = 0;
  let inline = 0;
  const targetId = ctx.target.id.toLowerCase();

  async function resolve(value: unknown, kind: AttachmentKind): Promise<string | undefined> {
    if (value == null || value === "") return undefined;
    if (typeof value !== "string") throw new AttachmentError("invalid_attachment", "Allegato non valido.");
    if (++count > MAX_ATTACHMENTS_PER_REQUEST) throw new AttachmentError("too_many_attachments", "Troppi allegati.");
    const hit = memo.get(kind + "|" + value);
    if (hit) return hit;
    let out: string;
    if (isDataUri(value)) {
      if (++inline > MAX_INLINE_UPLOADS) throw new AttachmentError("use_upload_endpoint", "Allegati troppo pesanti: ricarica la pagina e riprova.");
      if (value.length > Math.ceil(MEDIA_MAX_BYTES * 1.4) + 200) throw new AttachmentError("too_large", `Il file è troppo grande (massimo ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB).`);
      const d = parseDataUri(value);
      if (!d) throw new AttachmentError("invalid_attachment", "Allegato non valido.");
      if (d.bytes.length > MEDIA_MAX_BYTES) throw new AttachmentError("too_large", `Il file è troppo grande (massimo ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB).`);
      const v = validateCheckinFile(kind, d.mime, d.bytes);
      if (!v.ok) throw new AttachmentError("invalid_attachment", v.error);
      out = await ctx.put(d.bytes, v.mime);
      uploadedNow.push(out);
    } else {
      const p = parseMediaRef(value);
      if (!p || p.bucket !== PRIVATE_BUCKET) throw new AttachmentError("invalid_attachment", "Allegato non valido.");
      if (p.parsed.scope !== ctx.target.scope || p.parsed.id !== targetId) throw new AttachmentError("foreign_attachment", "Allegato non appartenente a questa prenotazione.");
      if (!ctx.allowed.has(value) && !verifyUploadToken(ctx.secret, ctx.bookingId, value, ctx.tokens[value], ctx.now)) throw new AttachmentError("foreign_attachment", "Allegato non appartenente a questa prenotazione.");
      out = value;
    }
    memo.set(kind + "|" + value, out);
    return out;
  }
  return { resolve, uploadedNow };
}
