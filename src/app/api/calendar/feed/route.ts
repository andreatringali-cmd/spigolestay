import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyFeedToken, parseTenantBlob, bookingEvents, pulizieEvents, buildIcs, type FeedKind } from "@/lib/calendar-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Feed iCal PUBBLICO (nessun login: Google Calendar interroga questo URL da solo ogni
// tot ore). Protetto da un token firmato invece che da sessione — vedi calendar-feed.ts.
// GET /api/calendar/feed?u=<tenantId>&k=bookings|pulizie&t=<token>
export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return new Response("Servizio non configurato", { status: 503 });

  const u = new URL(req.url);
  const tenantId = (u.searchParams.get("u") || "").trim();
  const kind = (u.searchParams.get("k") || "").trim() as FeedKind;
  const token = (u.searchParams.get("t") || "").trim();
  if (!tenantId || (kind !== "bookings" && kind !== "pulizie")) return new Response("Parametri mancanti", { status: 400 });
  if (!verifyFeedToken(tenantId, kind, token)) return new Response("Token non valido", { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: row } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
  const data = parseTenantBlob((row as { data?: unknown } | null)?.data);

  const events = kind === "bookings" ? bookingEvents(data) : pulizieEvents(data);
  const calName = kind === "bookings" ? "Xenora — Prenotazioni" : "Xenora — Pulizie";
  const ics = buildIcs(calName, events);

  return new NextResponse(ics, {
    status: 200,
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" },
  });
}
