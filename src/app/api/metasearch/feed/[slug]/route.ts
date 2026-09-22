// Feed METASEARCH pubblico per struttura (xenora.it/api/metasearch/feed/<slug>).
//
// Espone prezzi + disponibilità dei prossimi ~90 giorni leggendo gli STESSI dati
// pubblici usati dal motore /prenota (tabella public_sites, snapshot sanificato).
// I comparatori (Google Hotel Ads "Free Booking Links", Trivago, ecc.) non usano
// una loro API key per leggerlo: puntano a questo URL e leggono il feed, che per
// ogni giorno/tipologia contiene un DEEP LINK diretto al booking engine.
//
// Formati:
//   ?format=json  (default) — comodo per integrazioni/verifica
//   ?format=xml   — piatto e leggibile (comparatori generici / Google Sheets IMPORTXML)
//
// Sola lettura, nessuna PII: usa esclusivamente i dati già pubblicati dal proprietario.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { effectiveBase, effectiveClosed } from "@/lib/pricing";
import type { RoomType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_KEY = "spigolestay:data:v1";
const HORIZON_DAYS = 90;

// Helper date: identici a quelli usati da /prenota, così il prezzo del feed
// coincide con quello mostrato all'ospite (parità tariffaria).
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDaysISO = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return toISO(d); };
const isWeekendISO = (iso: string) => { const day = new Date(iso).getDay(); return day === 5 || day === 6 || day === 0; };

type Blob = {
  structures?: Array<Record<string, unknown> & { id: string; name?: string; currency?: string; city?: string }>;
  roomTypes?: RoomType[];
  units?: Array<{ id: string; roomTypeId: string; structureId?: string; outOfService?: boolean }>;
  bookings?: Array<{ unitId: string | null; roomTypeId?: string; checkIn: string; checkOut: string; status?: string; channel?: string }>;
  rateOverrides?: Record<string, number>;
};

// Valuta ISO 4217 a partire dal campo struttura (che può essere "€", "EUR", "$"…).
function isoCurrency(raw?: string): string {
  const s = (raw || "").trim();
  if (!s) return "EUR";
  if (/eur|€/i.test(s)) return "EUR";
  if (/usd|\$/i.test(s)) return "USD";
  if (/gbp|£/i.test(s)) return "GBP";
  if (/chf/i.test(s)) return "CHF";
  const alpha = s.replace(/[^a-z]/gi, "").toUpperCase();
  return /^[A-Z]{3}$/.test(alpha) ? alpha : "EUR";
}

function xmlEsc(v: string | number): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await ctx.params;
  const slug = (rawSlug || "").trim().toLowerCase();
  const format = (req.nextUrl.searchParams.get("format") || "json").toLowerCase();

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!sbUrl || !key) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503, headers: CORS });
  if (!slug) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: CORS });

  let siteData: Record<string, string> | null = null;
  let structureId = "";
  let structureName = "";
  try {
    const db = createClient(sbUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from("public_sites").select("data, structure_id, structure_name").eq("slug", slug).maybeSingle();
    if (error) return NextResponse.json({ error: "read_error" }, { status: 500, headers: CORS });
    if (!data || !data.data) return NextResponse.json({ error: "site_not_found" }, { status: 404, headers: CORS });
    siteData = data.data as Record<string, string>;
    structureId = (data.structure_id as string) || "";
    structureName = (data.structure_name as string) || "";
  } catch {
    return NextResponse.json({ error: "read_error" }, { status: 500, headers: CORS });
  }

  // Estraggo lo snapshot dati (stesse chiavi del localStorage del proprietario).
  let blob: Blob = {};
  try { blob = JSON.parse(siteData[DATA_KEY] || "{}") as Blob; } catch { blob = {}; }
  let weekendPct = 25;
  try { const r = siteData["spigolestay:pricerules"]; if (r) weekendPct = JSON.parse(r).weekendPct ?? 25; } catch {}

  const allTypes: RoomType[] = Array.isArray(blob.roomTypes) ? blob.roomTypes : [];
  const structs = Array.isArray(blob.structures) ? blob.structures : [];
  const structure = structs.find((s) => s.id === structureId) || structs[0];
  const sid = structure?.id || structureId;
  structureName = structure?.name || structureName || slug;
  const currency = isoCurrency(structure?.currency as string | undefined);

  const units = Array.isArray(blob.units) ? blob.units : [];
  const bookings = Array.isArray(blob.bookings) ? blob.bookings : [];
  const overrides = blob.rateOverrides || {};

  // Tipologie vendibili della struttura, solo "madri" (le derivate sono varianti di
  // prezzo che condividono le camere fisiche della madre) — coerente con /prenota.
  const types = allTypes.filter((rt) => rt.structureId === sid && !effectiveClosed(rt, allTypes));
  const masters = types.filter((rt) => !rt.deriveFrom || !types.some((x) => x.id === rt.deriveFrom));

  // Prezzo standard del giorno per la tipologia (piano flessibile, senza sconti di
  // piano) — la stessa base che /prenota mostra come tariffa del giorno.
  const dayPrice = (rt: RoomType, iso: string): number => {
    const base = effectiveBase(rt, allTypes);
    const raw = overrides[`${rt.id}|${iso}`] ?? overrides[iso] ?? Math.round(base * (isWeekendISO(iso) ? 1 + weekendPct / 100 : 1));
    return Math.max(0, Math.round(raw));
  };

  // Camere disponibili della tipologia in una singola notte [iso, iso+1) —
  // stessa logica di occupazione del motore /prenota.
  const unitsOf = (rtId: string) => units.filter((u) => u.roomTypeId === rtId && !u.outOfService);
  const availFor = (rtId: string, iso: string, next: string): number => {
    const us = unitsOf(rtId);
    return us.filter((u) => !bookings.some((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.unitId === u.id && b.checkIn < next && b.checkOut > iso)).length;
  };

  const origin = req.nextUrl.origin;
  const deepLink = (rtId: string, ci: string, co: string) =>
    `${origin}/prenota?site=${encodeURIComponent(slug)}&checkin=${ci}&checkout=${co}&rt=${encodeURIComponent(rtId)}`;

  const today = toISO(new Date());
  type Rate = { date: string; checkout: string; roomTypeId: string; roomType: string; price: number; currency: string; available: number; deepLink: string };
  const rates: Rate[] = [];
  for (const rt of masters) {
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const date = addDaysISO(today, i);
      const checkout = addDaysISO(date, 1);
      rates.push({
        date,
        checkout,
        roomTypeId: rt.id,
        roomType: rt.name,
        price: dayPrice(rt, date),
        currency,
        available: availFor(rt.id, date, checkout),
        deepLink: deepLink(rt.id, date, checkout),
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const landing = `${origin}/prenota?site=${encodeURIComponent(slug)}`;
  const cacheHeaders = { "Cache-Control": "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600", ...CORS };

  if (format === "xml") {
    const rows = rates.map((r) =>
      `  <rate date="${xmlEsc(r.date)}" checkout="${xmlEsc(r.checkout)}" roomTypeId="${xmlEsc(r.roomTypeId)}" roomType="${xmlEsc(r.roomType)}" price="${xmlEsc(r.price)}" currency="${xmlEsc(r.currency)}" available="${xmlEsc(r.available)}" deepLink="${xmlEsc(r.deepLink)}"/>`
    ).join("\n");
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<metasearchFeed slug="${xmlEsc(slug)}" structure="${xmlEsc(structureName)}" currency="${xmlEsc(currency)}" days="${HORIZON_DAYS}" generated="${xmlEsc(generatedAt)}" landing="${xmlEsc(landing)}">\n` +
      `${rows}\n` +
      `</metasearchFeed>\n`;
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", ...cacheHeaders } });
  }

  return NextResponse.json({
    slug,
    structure: { id: sid, name: structureName, city: (structure?.city as string) || undefined, currency },
    generatedAt,
    days: HORIZON_DAYS,
    landing,
    rates,
  }, { headers: cacheHeaders });
}
