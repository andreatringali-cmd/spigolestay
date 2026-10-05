// Disponibilità e prezzo per date e ospiti, per assistenti AI e comparatori. Sola lettura, nessun dato personale.
//   GET /api/ai/<slug>/quote?checkin=AAAA-MM-GG&checkout=AAAA-MM-GG&adults=2&children=0
// Restituisce le camere libere con il prezzo del soggiorno (indicativo) e il link diretto per prenotare: l'assistente NON prenota,
// manda l'ospite alla pagina di prenotazione della struttura.
import { NextRequest, NextResponse } from "next/server";
import { loadAiSite, buildQuote } from "@/lib/ai-site";
import { rateLimited } from "@/lib/server-auth";
import { clientIp } from "@/lib/server-booking-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

const isISO = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  if (rateLimited("aiq:" + clientIp(req), 60, 60_000)) return NextResponse.json({ error: "troppe_richieste" }, { status: 429, headers: CORS });
  const { slug } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const ci = (q.get("checkin") || q.get("checkIn") || "").trim();
  const co = (q.get("checkout") || q.get("checkOut") || "").trim();
  const adults = Math.min(20, Math.max(1, parseInt(q.get("adults") || "2", 10) || 2));
  const children = Math.min(20, Math.max(0, parseInt(q.get("children") || "0", 10) || 0));
  if (!isISO(ci) || !isISO(co) || co <= ci) return NextResponse.json({ error: "bad_request", message: "Servono checkin e checkout nel formato AAAA-MM-GG, con checkout dopo checkin." }, { status: 400, headers: CORS });
  const nights = Math.round((Date.parse(co) - Date.parse(ci)) / 86400000);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const limit = new Date(Date.now() + 2 * 365 * 86400000).toISOString().slice(0, 10);
  if (nights > 60 || ci < yesterday || ci > limit) return NextResponse.json({ error: "bad_dates", message: "Date non valide: massimo 60 notti, non nel passato e non oltre due anni." }, { status: 400, headers: CORS });
  const d = await loadAiSite(slug, req.nextUrl.origin);
  if (!d) return NextResponse.json({ error: "site_not_found" }, { status: 404, headers: CORS });
  return NextResponse.json(buildQuote(d, ci, co, adults, children, req.nextUrl.origin), { headers: { "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300", ...CORS } });
}
