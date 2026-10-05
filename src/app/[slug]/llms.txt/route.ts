// llms.txt della struttura: riepilogo leggibile dai modelli linguistici (xenora.it/<slug>/llms.txt). Solo dati pubblici.
import { NextRequest } from "next/server";
import { loadAiSite, buildLlmsTxt } from "@/lib/ai-site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const d = await loadAiSite(slug, req.nextUrl.origin);
  if (!d) return new Response("Struttura non trovata\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(buildLlmsTxt(d.site, req.nextUrl.origin), { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=900" } });
}
