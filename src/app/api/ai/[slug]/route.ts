// Scheda strutturata di una struttura, pensata per assistenti AI e comparatori: solo dati pubblici, sola lettura.
//   GET /api/ai/<slug>   →  { site, bookingUrl, api }
import { NextRequest, NextResponse } from "next/server";
import { loadAiSite } from "@/lib/ai-site";
import { rateLimited } from "@/lib/server-auth";
import { clientIp } from "@/lib/server-booking-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  if (rateLimited("ai:" + clientIp(req), 60, 60_000)) return NextResponse.json({ error: "troppe_richieste" }, { status: 429, headers: CORS });
  const { slug } = await ctx.params;
  const d = await loadAiSite(slug, req.nextUrl.origin);
  if (!d) return NextResponse.json({ error: "site_not_found" }, { status: 404, headers: CORS });
  return NextResponse.json(
    { site: d.site, api: { quote: `${req.nextUrl.origin}/api/ai/${d.site.slug}/quote?checkin=AAAA-MM-GG&checkout=AAAA-MM-GG&adults=2`, llms: `${req.nextUrl.origin}/${d.site.slug}/llms.txt` } },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=900", ...CORS } },
  );
}
