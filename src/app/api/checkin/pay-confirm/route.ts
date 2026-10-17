import Stripe from "stripe";
import { siteOrigin } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimited } from "@/lib/server-auth";
import { clientIp } from "@/lib/server-booking-guard";
import { findBookingStore, findBookingStoreById } from "@/lib/manage-booking";
import { recordCheckinPayment } from "@/lib/checkin-pay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Registra sul SERVER il pagamento del saldo fatto dall'ospite al check-in.
// Verifica la sessione Stripe e registra l'incasso con la stessa logica (idempotente) del webhook Stripe: vedi lib/checkin-pay.ts.
export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  if (!key) return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 503 });
  if (rateLimited("cpc:" + clientIp(req), 30, 60_000)) return NextResponse.json({ ok: false, error: "troppe_richieste" }, { status: 429 });
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const bid = String(body?.b || "").trim();
    const sessionId = String(body?.session_id || "").trim();
    if (!bid || !sessionId) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    let store = slug ? await findBookingStore(admin, slug, bid) : null;
    if (!store) store = await findBookingStoreById(admin, bid);
    if (!store) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const stripe = new Stripe(key);
    // Destination charge: la sessione è sull'account PIATTAFORMA (niente stripeAccount header).
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (session.payment_status !== "paid") return NextResponse.json({ ok: false, error: "not_paid" }, { status: 402 });

    const r = await recordCheckinPayment(admin, store, session as never, { origin: siteOrigin(req) });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, amount: r.amount, ...(r.already ? { already: true } : {}), ...(r.refundedCents ? { refunded: r.refundedCents / 100 } : {}) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
