// Route recensioni REALI (per ora Google). Riceve ?placeId= (o ?structureId= come eco)
// e restituisce le recensioni Google normalizzate, oppure { configured:false } se manca
// GOOGLE_PLACES_API_KEY lato server.
//
// Auth: se il backend Supabase è configurato (URL + service role), richiede un bearer
// valido (solo utenti loggati). In modalità solo-locale (senza Supabase) resta aperta,
// così il prototipo gira anche senza backend.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchGoogleReviews } from "@/lib/reviews/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureAuth(req: NextRequest): Promise<NextResponse | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Backend non configurato: modalità solo-locale, nessun gate.
  if (!url || !service) return null;
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return null;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function GET(req: NextRequest) {
  const gate = await ensureAuth(req);
  if (gate) return gate;

  const placeId = (req.nextUrl.searchParams.get("placeId") || "").trim();
  const structureId = (req.nextUrl.searchParams.get("structureId") || "").trim();

  // Senza placeId funziona da "sonda" di configurazione: dice solo se la key è impostata.
  if (!placeId) {
    return NextResponse.json({
      configured: Boolean(process.env.GOOGLE_PLACES_API_KEY),
      reviews: [],
      structureId: structureId || undefined,
    });
  }

  const res = await fetchGoogleReviews(placeId);
  const status = res.configured && res.error ? 502 : 200;
  return NextResponse.json({ ...res, structureId: structureId || undefined }, { status });
}
