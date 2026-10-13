import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

const PAY = "/api/stripe/chat-pay/go";
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Il pagamento passa da una piccola pagina con le anteprime Open Graph (WhatsApp legge titolo, sottotitolo e miniatura da qui) e poi inoltra al pagamento.
function payPreview(origin: string, target: string): Response {
  const title = "Pagamento online";
  const desc = "Paga con carta, in modo sicuro, in pochi secondi.";
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title><meta name="description" content="${desc}">
<meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
<meta property="og:image" content="${origin}/og-pagamento.png"><meta property="og:image:width" content="256"><meta property="og:image:height" content="256">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${origin}/og-pagamento.png">
<meta http-equiv="refresh" content="0;url=${esc(target)}"></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:40px 16px;color:#3b4553"><p>Ti stiamo portando al pagamento…</p><p><a href="${esc(target)}">Continua</a></p></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

// Risolve un link corto /g/<code> e reindirizza alla guida completa.
// Solo target che iniziano con /guida/, /checkin, /preventivo o il pagamento in chat (niente open redirect).
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const fallback = new URL("/guida/index.html", req.url);
  if (!supabase || !code) return NextResponse.redirect(fallback, 302);
  try {
    const { data } = await supabase.from("short_links").select("target").eq("code", code).maybeSingle();
    const target = data?.target;
    if (target && target.startsWith(PAY)) return payPreview(new URL(req.url).origin, target);
    if (target && (target.startsWith("/guida/") || target.startsWith("/checkin") || target.startsWith("/preventivo"))) return NextResponse.redirect(new URL(target, req.url), 302);
  } catch {}
  return NextResponse.redirect(fallback, 302);
}
