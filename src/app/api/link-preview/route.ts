import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Anteprima link (titolo, descrizione, immagine) per la chat di Messaggi. Solo host propri:
// niente fetch di indirizzi arbitrari (SSRF). I redirect sono seguiti a mano, controllando
// l'host a ogni salto (i link corti /g/<codice> rimandano a /guida, /checkin, /preventivo).
const ALLOWED = new Set(["xenora.it", "www.xenora.it", "spigole-guest-guide.vercel.app"]);

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0] || "";
  const c = tag.match(/content=(["'])([\s\S]*?)\1/i)?.[2];
  return c ? decode(c).trim() : "";
};

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") || "";
  let u: URL;
  try { u = new URL(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (u.protocol !== "https:" || !ALLOWED.has(u.hostname)) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(u.toString(), { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; XenoraLinkPreview/1.0)" }, signal: AbortSignal.timeout(6000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, u);
        if (next.protocol !== "https:" || !ALLOWED.has(next.hostname)) return NextResponse.json({ ok: false }, { status: 400 });
        u = next; continue;
      }
      break;
    }
    if (!res || !res.ok) return NextResponse.json({ ok: false }, { status: 502 });
    const html = (await res.text()).slice(0, 200_000);
    const title = meta(html, "og:title") || decode(html.match(/<title>([^<]*)/i)?.[1] || "").trim();
    const description = meta(html, "og:description") || meta(html, "description");
    let image = meta(html, "og:image");
    if (image) { try { image = new URL(image, u).toString(); } catch { image = ""; } }
    if (image && !ALLOWED.has(new URL(image).hostname)) image = "";
    if (!title && !description) return NextResponse.json({ ok: false });
    return NextResponse.json({ ok: true, title, description, image, host: u.hostname }, { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
