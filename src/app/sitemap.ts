// sitemap.xml: pagine pubbliche di Xenora e tutti i siti Xenosite pubblicati (solo l'indirizzo, nessun dato).
import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";

const ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://xenora.it").replace(/\/+$/, "");
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const out: MetadataRoute.Sitemap = [
    { url: `${ORIGIN}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${ORIGIN}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${ORIGIN}/termini`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return out;
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await db.from("public_sites").select("slug, updated_at").limit(5000);
    for (const r of (data ?? []) as { slug?: string; updated_at?: string }[]) {
      if (!r.slug || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(r.slug)) continue;
      out.push({ url: `${ORIGIN}/${r.slug}`, lastModified: r.updated_at ? new Date(r.updated_at) : now, changeFrequency: "daily", priority: 0.8 });
    }
  } catch { /* senza database la sitemap resta con le pagine fisse */ }
  return out;
}
