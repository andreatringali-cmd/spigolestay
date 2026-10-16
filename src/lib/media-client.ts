// Media su Supabase Storage — parte BROWSER (formato dei riferimenti e regole: vedi media.ts).
//
//  - uploadImage(...)      carica una foto/PDF (File, Blob o data URI) e restituisce il riferimento da salvare nei dati;
//  - resolveMediaUrl(src)  da QUALUNQUE valore salvato (data URI vecchia, URL, riferimento) all'URL da mettere in <img src>;
//  - deleteMedia(ref)      toglie il file dallo Storage.
// I componenti React usano <MediaImg src=…/> (components/MediaImg.tsx), che fa tutto questo da solo.
import { supabase } from "./supabase";
import {
  MEDIA_JPEG_QUALITY, MEDIA_MAX_BYTES, MEDIA_MAX_SIDE, SIGNED_URL_CLIENT_CACHE_MS, fitWithin, parseDataUri, parseMediaRef, publicUrlOf,
  type MediaVisibility,
} from "./media";

export interface UploadOptions {
  /** Salva sotto un'organizzazione condivisa (di cui sei membro) invece che sotto il tuo account. */
  orgId?: string;
  /** Lato massimo in px per la riduzione (default 1600). I PDF e le GIF non vengono mai ridotti. */
  maxSide?: number;
  /** Qualità JPEG 0..1 (default 0.72). */
  quality?: number;
  /** Formato della riduzione: "jpeg" (default, sfondo bianco al posto della trasparenza) o "png" (loghi con trasparenza). */
  format?: "jpeg" | "png";
  /** Se false carica il file così com'è (nessuna riduzione). Default true. */
  reduce?: boolean;
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q));

/** Riduce un'immagine (lato max + JPEG/PNG). Se è già piccola o non riducibile, restituisce il blob originale. PDF e GIF: intatti. */
export async function reduceImageBlob(blob: Blob, o: Pick<UploadOptions, "maxSide" | "quality" | "format"> = {}): Promise<Blob> {
  const type = (blob.type || "").toLowerCase();
  if (type === "application/pdf" || type === "image/gif" || !type.startsWith("image/")) return blob;
  if (typeof document === "undefined") return blob;
  const maxSide = o.maxSide ?? MEDIA_MAX_SIDE;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Immagine non valida"));
      el.src = url;
    });
    const { width, height } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, maxSide);
    const already = width === (img.naturalWidth || img.width) && height === (img.naturalHeight || img.height);
    if (already && blob.size <= 400 * 1024 && (type === "image/jpeg" || type === "image/png" || type === "image/webp")) return blob; // già piccola: non la degrado
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    const png = o.format === "png";
    if (!png) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); } // il JPEG non ha trasparenza
    ctx.drawImage(img, 0, 0, width, height);
    const out = await toBlob(canvas, png ? "image/png" : "image/jpeg", o.quality ?? MEDIA_JPEG_QUALITY);
    // Se la "riduzione" è più pesante dell'originale (succede con PNG già ottimizzati) tengo l'originale.
    return out && (out.size < blob.size || !already) ? out : blob;
  } finally { URL.revokeObjectURL(url); }
}

const blobToDataUri = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error("Lettura file fallita"));
  r.readAsDataURL(b);
});

async function bearer(): Promise<string> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new Error("Devi essere connesso");
  return token;
}

/**
 * Carica una foto (o un PDF, solo per i privati) su Storage e restituisce il riferimento "media:<bucket>:<percorso>".
 * Accetta un File/Blob oppure una data URI (utile per le foto già in memoria: webcam, canvas, firme).
 * Se riceve già un riferimento lo restituisce invariato. Le immagini vengono ridotte lato client (1600 px, JPEG 0.72).
 * Unica eccezione: se Supabase non è configurato (modalità solo-locale, senza server) restituisce la data URI ridotta, perché non c'è dove caricare.
 */
export async function uploadImage(src: Blob | string, visibility: MediaVisibility, opts: UploadOptions = {}): Promise<string> {
  let blob: Blob;
  if (typeof src === "string") {
    if (parseMediaRef(src)) return src;
    const d = parseDataUri(src);
    if (!d) throw new Error("Immagine non valida");
    blob = new Blob([d.bytes as BlobPart], { type: d.mime });
  } else blob = src;
  if (opts.reduce !== false) blob = await reduceImageBlob(blob, opts);
  if (blob.size > MEDIA_MAX_BYTES) throw new Error(`Il file è troppo grande (massimo ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB).`);
  if (!supabase) return blobToDataUri(blob);
  const token = await bearer();
  const form = new FormData();
  form.append("file", blob, "upload");
  form.append("visibility", visibility);
  if (opts.orgId) form.append("orgId", opts.orgId);
  const r = await fetch("/api/media", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const j = (await r.json().catch(() => ({}))) as { ref?: string; message?: string; error?: string };
  if (!r.ok || !j.ref) throw new Error(j.message || j.error || "Caricamento non riuscito");
  return j.ref;
}

/** Elimina il file dallo Storage (solo del tuo account/organizzazione). Un valore che non è un riferimento viene ignorato. */
export async function deleteMedia(ref: string): Promise<boolean> {
  if (!parseMediaRef(ref)) return false;
  try {
    const r = await fetch(`/api/media?ref=${encodeURIComponent(ref)}`, { method: "DELETE", headers: { Authorization: `Bearer ${await bearer()}` } });
    return r.ok;
  } catch { return false; }
}

// ---- Lettura -------------------------------------------------------------------------------------------------------------
const signedCache = new Map<string, { url: string; exp: number }>();
const inflight = new Map<string, Promise<string>>();

/**
 * URL pronto per <img src> SENZA rete, se possibile: data URI, blob:, http(s) e percorsi relativi invariati; riferimento pubblico → URL pubblico;
 * riferimento privato già in cache → URL firmato. Altrimenti null (serve resolveMediaUrl, asincrono). Stringa vuota → "".
 */
export function resolveMediaUrlSync(src: string | null | undefined): string | null {
  if (!src) return "";
  const p = parseMediaRef(src);
  if (!p) return src; // data URI, http(s), blob:, "/xenora-mark.png"… già utilizzabili
  if (p.visibility === "public") return publicUrlOf(src) ?? "";
  const hit = signedCache.get(src);
  return hit && hit.exp > Date.now() ? hit.url : null;
}

/** URL firmato di un riferimento privato (cache in memoria ~4 minuti, richieste identiche condivise). Lancia un errore se non disponibile. */
export function signedUrlFor(ref: string): Promise<string> {
  const hit = signedCache.get(ref);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url);
  const pending = inflight.get(ref);
  if (pending) return pending;
  const p = (async () => {
    const r = await fetch(`/api/media?ref=${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${await bearer()}` } });
    const j = (await r.json().catch(() => ({}))) as { url?: string; message?: string };
    if (!r.ok || !j.url) throw new Error(j.message || "File non disponibile");
    signedCache.set(ref, { url: j.url, exp: Date.now() + SIGNED_URL_CLIENT_CACHE_MS });
    return j.url;
  })().finally(() => { inflight.delete(ref); });
  inflight.set(ref, p);
  return p;
}

/**
 * Da QUALUNQUE valore salvato all'URL da mostrare. Data URI e http(s) → invariati; riferimento pubblico → URL pubblico (sincrono);
 * riferimento privato → Promise dell'URL firmato (cache ~4 min). Tipo di ritorno string | Promise<string>.
 */
export function resolveMediaUrl(src: string | null | undefined): string | Promise<string> {
  const sync = resolveMediaUrlSync(src);
  if (sync !== null) return sync;
  return signedUrlFor(src as string);
}

/** Come resolveMediaUrl ma sempre asincrona (comoda con await). */
export async function resolveMediaUrlAsync(src: string | null | undefined): Promise<string> {
  return resolveMediaUrl(src);
}

/** Per `background: … url(…)`: valore CSS pronto (`url("…")`) per data URI, URL e riferimenti pubblici; "none" se vuoto o non risolvibile subito (i privati non servono mai come sfondo). */
export function cssBgUrl(src: string | null | undefined): string {
  const u = resolveMediaUrlSync(src);
  return u ? `url("${u.split('"').join("")}")` : "none";
}
