import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

// Messaggio per i link sbagliati/scaduti: mai la guida demo, mai un redirect a caso. Lingua dal browser dell'ospite.
const INVALID: Record<string, { t: string; p: string }> = {
  it: { t: "Link non valido o scaduto", p: "Questo link non è più valido. Contatta la struttura per ricevere il link corretto." },
  en: { t: "Link invalid or expired", p: "This link is no longer valid. Please contact your host to get the correct link." },
  de: { t: "Link ungültig oder abgelaufen", p: "Dieser Link ist nicht mehr gültig. Bitte kontaktieren Sie die Unterkunft, um den richtigen Link zu erhalten." },
  fr: { t: "Lien invalide ou expiré", p: "Ce lien n'est plus valide. Veuillez contacter l'établissement pour recevoir le bon lien." },
  es: { t: "Enlace no válido o caducado", p: "Este enlace ya no es válido. Ponte en contacto con el alojamiento para recibir el enlace correcto." },
};
function pickLang(header: string | null): string {
  for (const part of (header || "").split(",")) {
    const c = part.trim().slice(0, 2).toLowerCase();
    if (INVALID[c]) return c;
  }
  return "en";
}
function invalidLink(req: Request): Response {
  const lang = pickLang(req.headers.get("accept-language"));
  const m = INVALID[lang];
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(m.t)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:#f6f4ef;color:#2b2b2b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center">
<div style="max-width:340px"><div style="font-size:42px;line-height:1;margin-bottom:14px" aria-hidden="true">&#128279;</div><h1 style="font-size:20px;margin:0 0 10px">${esc(m.t)}</h1><p style="font-size:15px;line-height:1.5;margin:0;color:#555">${esc(m.p)}</p></div></body></html>`;
  return new Response(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

// Cerca il target del link corto. La tabella short_links NON deve essere leggibile in blocco dall'API pubblica (contiene id prenotazione,
// nome ospite e codici d'ingresso): si usa la chiave di servizio se c'è, altrimenti la funzione get_short_link(code) (security definer).
// Ultimo ripiego (finché la policy anon esiste ancora): lettura diretta per codice.
async function resolveTarget(code: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && service) {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await admin.from("short_links").select("target").eq("code", code).maybeSingle();
    return (data as { target?: string } | null)?.target ?? null;
  }
  if (!supabase) return null;
  const rpc = await supabase.rpc("get_short_link", { p_code: code });
  if (!rpc.error) return typeof rpc.data === "string" ? rpc.data : null;
  const { data } = await supabase.from("short_links").select("target").eq("code", code).maybeSingle();
  return (data as { target?: string } | null)?.target ?? null;
}

// Risolve un link corto /g/<code> e reindirizza alla guida completa.
// Solo target che iniziano con /guida/, /checkin, /preventivo o il pagamento in chat (niente open redirect).
// Codice sbagliato/scaduto → pagina "Link non valido o scaduto" (404), non la guida demo.
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!code || !/^[a-zA-Z0-9]{4,16}$/.test(code)) return invalidLink(req);
  try {
    const target = await resolveTarget(code);
    if (target && target.startsWith(PAY)) return payPreview(new URL(req.url).origin, target);
    if (target && (target.startsWith("/guida/") || target.startsWith("/checkin") || target.startsWith("/preventivo"))) return NextResponse.redirect(new URL(target, req.url), 302);
  } catch {}
  return invalidLink(req);
}
