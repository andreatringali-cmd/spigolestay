import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Le email (Gmail, Outlook, Yahoo…) NON mostrano immagini incorporate come data: URI — le
// bloccano per sicurezza/antispam. Per far vedere un'immagine reale in un'email serve un URL
// pubblico vero: la carichiamo su uno storage pubblico (Supabase) e restituiamo quell'URL.
// Il PDF non ha questo limite (l'immagine è incorporata nel file) e continua a usare i dati grezzi.

const BUCKET = "email-assets";
let bucketReady = false;

function admin() {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return null;
  return createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function uploadPublicAsset(bytes: Buffer, ext: "png" | "jpg", contentType: string): Promise<string | null> {
  const sb = admin();
  if (!sb) return null;
  try {
    if (!bucketReady) {
      await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {}); // ignora se esiste già
      bucketReady = true;
    }
    // Nome file = hash del contenuto: invii ripetuti della stessa immagine riusano lo stesso file.
    const hash = crypto.createHash("sha1").update(bytes).digest("hex");
    const path = `${hash}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error) { console.error("uploadPublicAsset:", error.message); return null; }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (e) { console.error("uploadPublicAsset:", e instanceof Error ? e.message : e); return null; }
}

export function dataUrlToBytes(dataUrl: string): { bytes: Buffer; ext: "png" | "jpg"; contentType: string } | null {
  const m = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!m) return null;
  const ext: "png" | "jpg" = /png/i.test(m[1]) ? "png" : "jpg";
  return { bytes: Buffer.from(m[2], "base64"), ext, contentType: ext === "png" ? "image/png" : "image/jpeg" };
}
