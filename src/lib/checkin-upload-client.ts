// Check-in online (browser dell'ospite, ANONIMO) — caricamento degli allegati su Storage privato, uno per volta.
// Il server (POST /api/checkin/upload) valida il file, lo salva nel bucket privato e restituisce { ref, token }.
// Il POST finale di /api/checkin manda poi solo i riferimenti + i token (vedi lib/checkin-media.ts per le regole).
import { isMediaRef, parseDataUri } from "./media";
import { resolveMediaUrlAsync } from "./media-client";

export type AttachmentKind = "photo" | "signature";
export interface CheckinUploadCtx { slug: string; b: string }
export interface UploadedAttachment { ref: string; token?: string }

// Stessa data URI + stessa prenotazione = stesso file: se il POST finale fallisce e l'ospite riprova non si ricarica tutto da capo.
const memo = new Map<string, UploadedAttachment>();

/**
 * Valore di una foto/firma nel modulo → riferimento da inviare.
 *  - vuoto → undefined (nessun cambio);
 *  - riferimento già salvato (l'operatore che riapre il check-in) → invariato, senza token (il server lo riconosce);
 *  - data URI (foto appena scattata) → caricata su /api/checkin/upload.
 * Lancia un errore se il caricamento non riesce.
 */
export async function uploadCheckinAttachment(src: string | undefined | null, kind: AttachmentKind, ctx: CheckinUploadCtx): Promise<UploadedAttachment | undefined> {
  if (!src) return undefined;
  if (isMediaRef(src)) return { ref: src };
  const key = `${ctx.b}|${kind}|${src}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const d = parseDataUri(src);
  if (!d) throw new Error("Immagine non valida");
  const form = new FormData();
  form.append("file", new Blob([d.bytes as BlobPart], { type: d.mime }), "upload");
  form.append("b", ctx.b);
  form.append("slug", ctx.slug);
  form.append("kind", kind);
  const r = await fetch("/api/checkin/upload", { method: "POST", body: form });
  const j = (await r.json().catch(() => ({}))) as { ref?: string; token?: string; message?: string; error?: string };
  if (!r.ok || !j.ref) throw new Error(j.message || j.error || "Caricamento non riuscito");
  const out = { ref: j.ref, token: j.token };
  memo.set(key, out);
  return out;
}

/** Esegue `fn` su tutti gli elementi con al massimo `limit` richieste in parallelo (mantiene l'ordine dei risultati). */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const blobToDataUri = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error("Lettura file fallita"));
  r.readAsDataURL(b);
});

/** Foto salvata (data URI o riferimento privato) → data URI, per la lettura automatica dei dati dal documento. */
export async function photoAsDataUri(src: string): Promise<string> {
  if (/^data:/i.test(src)) return src;
  const url = await resolveMediaUrlAsync(src);
  const r = await fetch(url);
  if (!r.ok) throw new Error("File non disponibile");
  return blobToDataUri(await r.blob());
}
