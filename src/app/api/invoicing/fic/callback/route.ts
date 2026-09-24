import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyState, exchangeCode, listCompanies, saveFicTokens } from "@/lib/invoicing/fic-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Callback OAuth di Fatture in Cloud: verifica lo state firmato, scambia il code
// per i token, sceglie l'azienda e salva le credenziali cifrate per il tenant.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/impostazioni-fattura?${q}`);

  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const err = url.searchParams.get("error");
  if (err) return back(`fic=error&msg=${encodeURIComponent(err)}`);
  if (!code || !state) return back("fic=error&msg=parametri_mancanti");

  const st = verifyState(state);
  if (!st) return back("fic=error&msg=state_non_valido");

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return back("fic=error&msg=supabase");
  const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const redirectUri = process.env.FIC_REDIRECT_URI || `${origin}/api/invoicing/fic/callback`;
  try {
    const tokens = await exchangeCode(code, redirectUri);
    const companies = await listCompanies(tokens.access_token);
    const company = companies[0]; // di norma una sola azienda per account
    // Alla prima connessione la MODALITÀ PROVA è attiva: i documenti si creano su
    // Fatture in Cloud senza trasmettere allo SdI, finché non la disattivi.
    await saveFicTokens(admin, st.tenantId, tokens, { companyId: company?.id, companyName: company?.name, dryRun: true });
    if (!company) return back("fic=nocompany");
    return back(`fic=connected&company=${encodeURIComponent(company.name)}`);
  } catch (e) {
    return back(`fic=error&msg=${encodeURIComponent((e as Error)?.message || "errore")}`);
  }
}
