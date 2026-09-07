import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apre il Customer Portal di Stripe (gestione metodo di pagamento, fatture, disdetta).
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });

  try {
    const body = await req.json().catch(() => ({}));
    const customerId = body?.customerId;
    if (!customerId) return NextResponse.json({ error: "missing_customer" }, { status: 400 });

    const stripe = new Stripe(key);
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const ps = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/abbonamento` });
    return NextResponse.json({ url: ps.url });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
