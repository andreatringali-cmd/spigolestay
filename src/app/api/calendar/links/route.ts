import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { feedUrl } from "@/lib/calendar-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Restituisce i due link (firmati) del feed iCal del tenant, pronti da incollare in
// Google Calendar ("Aggiungi altri calendari" → "Da URL"). Autenticato: solo l'utente
// stesso può scoprire il proprio link (che poi userà da anonimo, senza login).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://xenora.it";
  return NextResponse.json({
    ok: true,
    bookingsUrl: feedUrl(base, auth.tenantId, "bookings"),
    pulizieUrl: feedUrl(base, auth.tenantId, "pulizie"),
  });
}
