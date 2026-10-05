// Collegamento al database e ai prezzi dell'app per le funzioni pure di ai-site-core.ts (vedi lì la spiegazione e la regola sui dati pubblici).
import { createClient } from "@supabase/supabase-js";
import { effectiveBase, effectiveClosed, weekendPctFromRaw } from "./pricing";
import { buildAiSite, type AiQuoteData, type PricingDeps } from "./ai-site-core";

export * from "./ai-site-core";

const deps: PricingDeps = { effectiveBase, effectiveClosed, weekendPctFromRaw };

/** Lettura da public_sites (solo lettura, dati già pubblicati dal proprietario). */
export async function loadAiSite(slug: string, origin: string): Promise<AiQuoteData | null> {
  const clean = (slug || "").trim().toLowerCase();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(clean)) return null;
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from("public_sites").select("data, structure_id, structure_name").eq("slug", clean).maybeSingle();
    if (error || !data?.data) return null;
    return buildAiSite(clean, data.data as Record<string, string>, { structure_id: data.structure_id as string, structure_name: data.structure_name as string }, origin, deps);
  } catch { return null; }
}
