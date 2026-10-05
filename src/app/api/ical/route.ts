// Proxy server-side in SOLA LETTURA per scaricare un calendario iCal (Octorate/OTA) ed evitare
// il blocco CORS del browser. Non salva nulla: scarica e restituisce il testo iCal al client,
// che poi lo importa.
// Sicurezza: serve il login; l'host viene risolto via DNS e rifiutato se punta a indirizzi interni/privati;
// i redirect vengono seguiti a mano (max 3) rivalidando ogni destinazione; dimensione massima 3 MB.

import { NextRequest } from "next/server";
import { requireUser, isErr, rateLimited } from "@/lib/server-auth";
import { isPublicHost } from "@/lib/net-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export async function GET(req: NextRequest) {
  const who = await requireUser(req);
  if (isErr(who)) return who;
  if (rateLimited("ical:" + who.userId, 40, 60_000)) return new Response("Troppe richieste", { status: 429 });

  let url: URL;
  try { url = new URL(req.nextUrl.searchParams.get("url") || ""); } catch { return new Response("URL non valido", { status: 400 }); }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    let r: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== "http:" && url.protocol !== "https:") return new Response("Protocollo non ammesso", { status: 400 });
      if (!(await isPublicHost(url.hostname))) return new Response("Host non ammesso", { status: 400 });
      r = await fetch(url.toString(), {
        redirect: "manual",
        signal: ctrl.signal,
        cache: "no-store",
        headers: { "User-Agent": "Xenora-iCal-Sync/1.0", Accept: "text/calendar, text/plain, */*" },
      });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        try { url = new URL(r.headers.get("location")!, url); } catch { return new Response("Redirect non valido", { status: 502 }); }
        r = null;
        continue;
      }
      break;
    }
    if (!r) return new Response("Troppi reindirizzamenti", { status: 502 });
    if (!r.ok) return new Response(`Errore sorgente: ${r.status}`, { status: 502 });
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return new Response("Calendario troppo grande", { status: 413 });
    const text = await r.text();
    if (text.length > MAX_BYTES) return new Response("Calendario troppo grande", { status: 413 });
    if (!/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(text)) return new Response("Il contenuto non sembra un calendario iCal", { status: 422 });
    return new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return new Response("Impossibile scaricare il calendario", { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
