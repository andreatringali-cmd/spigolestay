// Proxy server-side in SOLA LETTURA per scaricare un calendario iCal (Octorate/OTA) ed evitare
// il blocco CORS del browser. Non salva nulla: scarica e restituisce il testo iCal al client,
// che poi lo importa. In produzione qui andrà un fetch schedulato lato server + validazioni.

import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Blocca target interni/privati (SSRF minimale).
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|169\.254\.|192\.168\.|0\.)/.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  return false;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") || "";
  let url: URL;
  try { url = new URL(raw); } catch { return new Response("URL non valido", { status: 400 }); }
  if (url.protocol !== "http:" && url.protocol !== "https:") return new Response("Protocollo non ammesso", { status: 400 });
  if (isBlockedHost(url.hostname)) return new Response("Host non ammesso", { status: 400 });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url.toString(), {
      redirect: "follow",
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": "Xenora-iCal-Sync/1.0", Accept: "text/calendar, text/plain, */*" },
    });
    if (!r.ok) return new Response(`Errore sorgente: ${r.status}`, { status: 502 });
    const text = await r.text();
    if (!/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(text)) return new Response("Il contenuto non sembra un calendario iCal", { status: 422 });
    return new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return new Response("Impossibile scaricare il calendario", { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
