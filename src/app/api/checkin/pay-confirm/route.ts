import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findBookingStore, mutateStore } from "@/lib/manage-booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);

// Registra sul SERVER il pagamento del saldo fatto dall'ospite al check-in.
// Verifica la sessione Stripe (sul conto connesso della struttura) e somma l'incassato.
export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  if (!key) return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 503 });
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const bid = String(body?.b || "").trim();
    const sessionId = String(body?.session_id || "").trim();
    if (!slug || !bid || !sessionId) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const store = await findBookingStore(admin, slug, bid);
    if (!store) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const st = (store.structure ?? {}) as Json;
    const acct = s(st.stripeAccount);
    if (!acct) return NextResponse.json({ ok: false, error: "no_account" }, { status: 400 });

    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.retrieve(sessionId, undefined, { stripeAccount: acct });
    if (session.payment_status !== "paid") return NextResponse.json({ ok: false, error: "not_paid" }, { status: 402 });
    const amount = Math.round((session.amount_total ?? 0) / 100);
    // Idempotenza: non risommare se questa sessione è già stata registrata.
    const already = arr((store.booking as Json).paidSessions).some((x) => s(x) === session.id);
    if (already) return NextResponse.json({ ok: true, already: true });

    const wrote = await mutateStore(admin, store, (data, idx) => {
      const bookings = arr(data.bookings);
      if (idx < 0 || idx >= bookings.length) return false;
      const bk = bookings[idx] as Json;
      const sessions = arr(bk.paidSessions).map(String);
      if (sessions.includes(session.id)) return false; // già registrata
      bookings[idx] = { ...bk, paid: n(bk.paid) + amount, paidSessions: [...sessions, session.id], updatedAt: Date.now() };
      data.bookings = bookings;
      return true;
    });
    return NextResponse.json({ ok: wrote, amount });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
