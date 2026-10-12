import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { siteOrigin } from "@/lib/server-auth";
import { verifyState, exchangeGbpCode, saveGbpTokens } from "@/lib/google-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ritorno dal consenso Google: verifica lo state firmato, scambia il code per i token e li salva cifrati.
// Poi si torna alla pagina Recensioni, dove si sceglie la sede Google di ogni struttura.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = siteOrigin(req);
  const back = (q: string) => NextResponse.redirect(`${origin}/recensioni?${q}`);

  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const err = url.searchParams.get("error");
  if (err) return back(`gbp=error&msg=${encodeURIComponent(err)}`);
  if (!code || !state) return back("gbp=error&msg=parametri_mancanti");
  const st = verifyState(state);
  if (!st) return back("gbp=error&msg=state_non_valido");

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return back("gbp=error&msg=supabase");
  const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const redirectUri = process.env.GBP_REDIRECT_URI || `${origin}/api/google-business/callback`;
  try {
    const tokens = await exchangeGbpCode(code, redirectUri);
    await saveGbpTokens(admin, st.tenantId, tokens);
    return back("gbp=connected");
  } catch (e) {
    return back(`gbp=error&msg=${encodeURIComponent(((e as Error)?.message || "errore").slice(0, 120))}`);
  }
}
