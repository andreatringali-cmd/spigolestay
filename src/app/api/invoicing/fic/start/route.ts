import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { ficConfigured, signState, ficAuthorizeUrl } from "@/lib/invoicing/fic-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Avvia il collegamento OAuth a Fatture in Cloud per il tenant autenticato.
// Ritorna l'URL di autorizzazione (il client fa il redirect a tutta pagina).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!ficConfigured()) {
    return NextResponse.json({ error: "fic_not_configured", message: "Fatture in Cloud non è configurato sul server (FIC_CLIENT_ID/SECRET mancanti)." }, { status: 503 });
  }
  const origin = req.headers.get("origin") || new URL(req.url).origin;
  const redirectUri = process.env.FIC_REDIRECT_URI || `${origin}/api/invoicing/fic/callback`;
  const state = signState(auth.tenantId);
  const url = ficAuthorizeUrl(redirectUri, state);
  return NextResponse.json({ ok: true, url });
}
