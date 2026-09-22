// Endpoint rate-checker: riceve { structureId, from, days, competitors?, lat?, lng? },
// interroga il connettore di rate shopping e restituisce le righe di mercato reali
// oppure { configured:false } quando il provider non è configurato (env mancanti).
//
// Protezione minima: se Supabase è configurato si richiede un utente loggato (Bearer);
// se Supabase non è configurato (prototipo/locale) la route resta accessibile — non
// espone dati sensibili, solo medie di mercato pubbliche.
import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { fetchMarketRates, type Competitor } from "@/lib/ratecheck/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isISODate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function cleanCompetitors(raw: unknown): Competitor[] {
  if (!Array.isArray(raw)) return [];
  const out: Competitor[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    if (!name) continue;
    const url = o.url != null ? String(o.url).trim() : undefined;
    const id = o.id != null ? String(o.id).trim() : undefined;
    out.push({ name: name.slice(0, 120), url: url || undefined, id: id || undefined });
    if (out.length >= 50) break;
  }
  return out;
}

export async function POST(req: Request) {
  // Auth minima: obbligatoria solo se Supabase è configurato.
  const auth = await authTenant(req);
  if (isResponse(auth) && auth.status !== 503) return auth;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const from = isISODate((body as Record<string, unknown>)?.from)
      ? String((body as Record<string, unknown>).from)
      : new Date().toISOString().slice(0, 10);
    const daysRaw = Number((body as Record<string, unknown>)?.days);
    const days = Number.isFinite(daysRaw) ? Math.min(60, Math.max(1, Math.round(daysRaw))) : 14;
    const to = addDays(from, days);
    const competitors = cleanCompetitors((body as Record<string, unknown>)?.competitors);
    const latRaw = Number((body as Record<string, unknown>)?.lat);
    const lngRaw = Number((body as Record<string, unknown>)?.lng);
    const lat = Number.isFinite(latRaw) ? latRaw : undefined;
    const lng = Number.isFinite(lngRaw) ? lngRaw : undefined;

    const res = await fetchMarketRates({ from, to, lat, lng, competitors });
    if (!res.configured) return NextResponse.json({ configured: false });
    return NextResponse.json({ configured: true, rows: res.rows, error: res.error ?? null });
  } catch (e) {
    return NextResponse.json({ error: "ratecheck_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
