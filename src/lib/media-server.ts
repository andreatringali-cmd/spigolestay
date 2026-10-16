// Media su Supabase Storage — parte SOLO SERVER (usa il client service-role).
// Formato dei riferimenti e regole sui percorsi: vedi media.ts. Da importare solo in route API / codice server.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MEDIA_MAX_BYTES, PRIVATE_BUCKET, PUBLIC_BUCKET, SIGNED_URL_SECONDS, allowedMimes, mediaRef, parseMediaRef, scopedPath, visibilityOf,
  type MediaBucket, type MediaScope,
} from "./media";

let bucketsReady = false;

/** Crea i due bucket se mancano (pubblico e privato). Idempotente; "già esiste" viene ignorato come negli altri bucket dell'app. */
export async function ensureBuckets(admin: SupabaseClient): Promise<void> {
  if (bucketsReady) return;
  await admin.storage.createBucket(PUBLIC_BUCKET, { public: true, fileSizeLimit: MEDIA_MAX_BYTES, allowedMimeTypes: Object.keys(allowedMimes("public")) }).catch(() => {});
  await admin.storage.createBucket(PRIVATE_BUCKET, { public: false, fileSizeLimit: MEDIA_MAX_BYTES, allowedMimeTypes: Object.keys(allowedMimes("private")) }).catch(() => {});
  bucketsReady = true;
}

/**
 * Salva i byte nel bucket e restituisce il riferimento da mettere nei dati.
 * `id` = tenantId (scope "u") oppure id dell'organizzazione (scope "o"). Lancia un errore se il tipo non è ammesso o l'upload fallisce.
 * Nessun controllo sul contenuto qui: chi riceve i byte dall'esterno deve prima passare da checkUpload (media.ts).
 */
export async function putMedia(
  admin: SupabaseClient,
  opts: { bucket: MediaBucket; scope: MediaScope; id: string; mime: string; bytes: Uint8Array | ArrayBuffer },
): Promise<string> {
  const ext = allowedMimes(visibilityOf(opts.bucket))[opts.mime.toLowerCase()];
  if (!ext) throw new Error("Formato non ammesso");
  await ensureBuckets(admin);
  const path = scopedPath(opts.scope, opts.id, ext);
  const body = opts.bytes instanceof Uint8Array ? opts.bytes : new Uint8Array(opts.bytes);
  const { error } = await admin.storage.from(opts.bucket).upload(path, body, { contentType: opts.mime, upsert: false, cacheControl: opts.bucket === PUBLIC_BUCKET ? "31536000" : "3600" });
  if (error) throw new Error(error.message || "upload non riuscito");
  return mediaRef(opts.bucket, path);
}

/** URL firmato temporaneo (default 5 minuti) per un riferimento. null se il riferimento non è valido o il file non esiste. */
export async function signedUrlOf(admin: SupabaseClient, ref: string, seconds: number = SIGNED_URL_SECONDS): Promise<string | null> {
  const p = parseMediaRef(ref);
  if (!p) return null;
  const { data, error } = await admin.storage.from(p.bucket).createSignedUrl(p.path, seconds);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

/** Toglie il file dallo Storage. true se rimosso (o già assente), false se riferimento non valido o errore. */
export async function removeMedia(admin: SupabaseClient, ref: string): Promise<boolean> {
  const p = parseMediaRef(ref);
  if (!p) return false;
  const { error } = await admin.storage.from(p.bucket).remove([p.path]);
  return !error;
}

/** Scarica i byte di un file (per uso server: OCR, PDF, allegati email, migrazione). null se non esiste. */
export async function downloadMedia(admin: SupabaseClient, ref: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const p = parseMediaRef(ref);
  if (!p) return null;
  const { data, error } = await admin.storage.from(p.bucket).download(p.path);
  if (error || !data) return null;
  return { mime: data.type || "application/octet-stream", bytes: new Uint8Array(await data.arrayBuffer()) };
}

/** Organizzazioni (attive) di cui l'utente è membro: servono a canAccessPath per i file con scope "o". Accetta più id utente (chiamante + titolare). */
export async function memberOrgIds(admin: SupabaseClient, userIds: readonly string[]): Promise<string[]> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return [];
  const { data } = await admin.from("memberships").select("org_id, active").in("user_id", ids);
  const out = new Set<string>();
  for (const r of (data ?? []) as { org_id?: string; active?: boolean | null }[]) if (r.org_id && r.active !== false) out.add(r.org_id);
  return [...out];
}
