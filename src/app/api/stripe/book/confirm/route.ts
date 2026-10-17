import Stripe from "stripe";
import { internalFetch } from "@/lib/server-auth";
import { siteOrigin } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findOwnerStructure, clientIp, loadOrgDataParts, mergeOwnerData } from "@/lib/server-booking-guard";
import { rateLimited } from "@/lib/server-auth";
import { publicBookingBodyFromSession, bookingSummaryFrom, bookingWriteFailure, type BookingSummary } from "@/lib/book-session";

type Json = Record<string, unknown>;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ritorna lo stripeAccount della struttura (personale o org condivisa) collegata allo slug.
async function acctForSlug(admin: Parameters<typeof findOwnerStructure>[0], slug: string): Promise<{ ownerId: string; sid: string; acct: string } | null> {
  const { data: site } = await admin.from("public_sites").select("user_id, structure_id").eq("slug", slug).maybeSingle();
  const s0 = site as { user_id?: string; structure_id?: string } | null;
  const ownerId = (s0?.user_id as string) || ""; const sid = (s0?.structure_id as string) || "";
  if (!ownerId || !sid) return null;
  const st = await findOwnerStructure(admin, ownerId, sid);
  return { ownerId, sid, acct: st && st.stripeAccount ? String(st.stripeAccount) : "" };
}

// Verifica che la sessione Stripe sia PAGATA, poi registra la prenotazione (via public-booking,
// idempotente sul token) che invia anche l'email di conferma.
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 503 });
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  try {
    const b = await req.json().catch(() => ({}));
    const sessionId = String(b?.session_id || "").trim();
    const slug = String(b?.slug || "").trim();
    if (!sessionId || !slug) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    if (rateLimited("bcf:" + clientIp(req), 30, 60_000)) return NextResponse.json({ ok: false, error: "troppe_richieste" }, { status: 429 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const resolved = await acctForSlug(admin, slug);
    if (!resolved?.acct) return NextResponse.json({ ok: false, error: "no_stripe_account" }, { status: 400 });

    const stripe = new Stripe(key);
    // Destination charge: la sessione è sull'account PIATTAFORMA (niente stripeAccount header).
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (session.payment_status !== "paid") return NextResponse.json({ ok: false, error: "not_paid", status: session.payment_status }, { status: 402 });
    const m = (session.metadata ?? {}) as Record<string, string>;
    // Solo sessioni create da /api/stripe/book (kind "book", dopo tutti i controlli) per QUESTA struttura: le sessioni di /api/stripe/quote hanno altri metadata.
    if (m.kind !== "book" || m.slug !== slug || (m.s && m.s !== resolved.sid)) return NextResponse.json({ ok: false, error: "not_a_booking_session" }, { status: 400 });
    const pi = session.payment_intent;
    const paymentIntent = typeof pi === "string" ? pi : (pi?.id || "");

    // Registra la prenotazione tramite public-booking (scrittura idempotente + email).
    const origin = siteOrigin(req);
    const pb = await internalFetch(`${origin}/api/public-booking`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(publicBookingBodyFromSession(session, { slug, paymentIntent, accountId: resolved.acct })),
    });
    const pj = await pb.json().catch(() => ({}));
    // Riepilogo per la pagina /prenota: si rilegge la prenotazione registrata (anche con already:true), altrimenti si ricava dai metadata della sessione.
    let booking: BookingSummary | undefined;
    if (pj?.ok) {
      try {
        const extId = `site:${slug}:${m.token || session.id}`;
        const parts: Json[] = [];
        const { data: row } = await admin.from("app_state").select("data").eq("user_id", resolved.ownerId).maybeSingle();
        try { parts.push(JSON.parse(String(((row as { data?: Record<string, string> } | null)?.data ?? {})["spigolestay:data:v1"] || "{}")) as Json); } catch { /* stato illeggibile */ }
        parts.push(...(await loadOrgDataParts(admin, resolved.ownerId)));
        const merged = mergeOwnerData(parts);
        const bk = merged.bookings.find((x) => x.extId === extId) ?? null;
        const sid = String(bk?.structureId || resolved.sid);
        const structure = merged.structures.find((x) => x.id === sid) ?? (await findOwnerStructure(admin, resolved.ownerId, sid));
        const roomType = merged.roomTypes.find((x) => x.id === String(bk?.roomTypeId || m.rt)) ?? null;
        const guest = bk ? (parts.flatMap((p) => (Array.isArray(p.guests) ? (p.guests as Json[]) : [])).find((x) => x.id === bk.guestId) ?? null) : null;
        booking = bookingSummaryFrom({ session, booking: bk, structure, roomType, guest });
      } catch { /* il riepilogo non e' critico: la pagina ripiega sui dati salvati */ }
    }
    // Scrittura non riuscita (pagamento gia' incassato): mai 200 con ok:false e senza `error` — il client non saprebbe se ritentare. Transitorio = 409/502, permanente = 422.
    if (!pj?.ok) {
      const fail = bookingWriteFailure(pb.status, pj);
      return NextResponse.json({ ok: false, error: fail.error, paid: true, retryable: !fail.permanent }, { status: fail.httpStatus });
    }
    return NextResponse.json({ ok: true, already: pj?.already, ...(booking ? { booking } : {}) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
