import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { gcalSyncConfigured, gcalServiceAccountEmail } from "@/lib/googleCalendarSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dice al client se la sync in tempo reale è attiva lato server (service account configurato)
// e con quale indirizzo l'utente deve condividere il suo calendario Google. L'email del
// service account non è un segreto (va condivisa apposta), ma l'endpoint resta autenticato
// come il resto dell'app.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  return NextResponse.json({ ok: true, configured: gcalSyncConfigured(), serviceAccountEmail: gcalServiceAccountEmail() });
}
