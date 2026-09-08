import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recupera il cliente Stripe dall'email (per riconoscere una carta già salvata anche
// senza passare da un checkout dall'app).
export async function GET(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });

  const email = new URL(req.url).searchParams.get("email");
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  try {
    const stripe = new Stripe(key);
    const list = await stripe.customers.list({ email, limit: 1 });
    const cust = list.data[0];
    if (!cust) return NextResponse.json({ customerId: null, hasCard: false, subscriptionStatus: null });

    // Carta salvata? (metodo predefinito o almeno una carta collegata)
    const defaultPm = cust.invoice_settings?.default_payment_method || null;
    const pms = await stripe.paymentMethods.list({ customer: cust.id, type: "card", limit: 1 });
    const hasCard = !!defaultPm || pms.data.length > 0;

    // Eventuale abbonamento
    const subs = await stripe.subscriptions.list({ customer: cust.id, status: "all", limit: 1 });
    const sub = subs.data[0];

    return NextResponse.json({ customerId: cust.id, hasCard, subscriptionStatus: sub?.status ?? null });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
