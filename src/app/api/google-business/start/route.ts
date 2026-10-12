import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/server-auth";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { gbpConfigured, signState, gbpAuthorizeUrl } from "@/lib/google-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Avvia il collegamento a Google Business Profile per il tenant autenticato.
// Ritorna l'URL di consenso di Google (il client fa il redirect a tutta pagina).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!gbpConfigured()) {
    return NextResponse.json({ error: "gbp_not_configured", message: "Google Business non è configurato sul server (GBP_CLIENT_ID/SECRET mancanti)." }, { status: 503 });
  }
  const redirectUri = process.env.GBP_REDIRECT_URI || `${siteOrigin(req)}/api/google-business/callback`;
  return NextResponse.json({ ok: true, url: gbpAuthorizeUrl(redirectUri, signState(auth.tenantId)) });
}
