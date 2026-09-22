// Route recensioni Google PUBBLICA (nessuna autenticazione).
// Serve al sito pubblico (Xenosite su xenora.it/<slug>): riceve ?placeId= e
// restituisce le recensioni Google normalizzate da fetchGoogleReviews().
//
// È sicura senza auth perché espone SOLO dati pubblici (le recensioni Google
// sono già visibili a chiunque su Google Maps) e non tocca lo store del
// proprietario. La GOOGLE_PLACES_API_KEY resta lato server e non viene mai
// esposta al client.

import { NextRequest, NextResponse } from "next/server";
import { fetchGoogleReviews } from "@/lib/reviews/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const placeId = (req.nextUrl.searchParams.get("placeId") || "").trim();

  // Senza placeId: risponde solo se la key è impostata (sonda di configurazione).
  if (!placeId) {
    return NextResponse.json({
      configured: Boolean(process.env.GOOGLE_PLACES_API_KEY),
      reviews: [],
    });
  }

  const res = await fetchGoogleReviews(placeId);
  const status = res.configured && res.error ? 502 : 200;
  return NextResponse.json(res, {
    status,
    // Cache breve lato CDN: le recensioni cambiano di rado, alleggerisce le chiamate a Google.
    headers: { "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400" },
  });
}
