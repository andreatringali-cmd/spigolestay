import Stripe from "stripe";
import { NextResponse } from "next/server";
import { planByKey, type StripePlan } from "@/lib/stripe-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trova (o crea al primo utilizzo) il Price ricorrente del piano, usando una lookup_key stabile.
// Così non serve creare nulla a mano nel pannello Stripe: si auto-provisiona.
async function getPriceId(stripe: Stripe, plan: StripePlan): Promise<string> {
  const lookup_key = `xenora_${plan.key}_month`;
  const found = await stripe.prices.list({ lookup_keys: [lookup_key], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const product = await stripe.products.create({ name: `Xenora ${plan.name}`, metadata: { plan: plan.key } });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.amount * 100,
    currency: "eur",
    recurring: { interval: "month" },
    lookup_key,
  });
  return price.id;
}

export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });

  try {
    const body = await req.json().catch(() => ({}));
    const plan = planByKey(body?.plan);
    if (!plan) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });

    const stripe = new Stripe(key);
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const price = await getPriceId(stripe, plan);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      customer_email: body?.email || undefined,
      client_reference_id: body?.userId || undefined,
      allow_promotion_codes: true,
      subscription_data: { trial_period_days: 7, metadata: { userId: body?.userId || "", plan: plan.key } },
      metadata: { userId: body?.userId || "", plan: plan.key },
      success_url: `${origin}/abbonamento?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/abbonamento?checkout=cancel`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
