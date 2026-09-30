import Stripe from "stripe";
import { NextResponse } from "next/server";
import { annualAmount, lookupKeyFor, planByKey, type BillingInterval, type StripePlan } from "@/lib/stripe-plans";
import { TRIAL_DAYS } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trova (o crea al primo utilizzo) il Price ricorrente del piano, usando una lookup_key stabile
// (una per piano+intervallo: xenora_{plan}_month / xenora_{plan}_year).
// Così non serve creare nulla a mano nel pannello Stripe: si auto-provisiona.
async function getPriceId(stripe: Stripe, plan: StripePlan, interval: BillingInterval): Promise<string> {
  const lookup_key = lookupKeyFor(plan, interval);
  // Cerco anche il Price dell'altro intervallo, così se esiste già riuso lo stesso Product
  // invece di crearne uno duplicato (es. "Xenora Basic" mensile + "Xenora Basic" annuale separati).
  const otherInterval: BillingInterval = interval === "year" ? "month" : "year";
  const other_lookup_key = lookupKeyFor(plan, otherInterval);
  const found = await stripe.prices.list({ lookup_keys: [lookup_key, other_lookup_key], active: true, limit: 2 });
  const exact = found.data.find((p) => p.lookup_key === lookup_key);
  if (exact) return exact.id;
  const sibling = found.data.find((p) => p.lookup_key === other_lookup_key);
  const productId = typeof sibling?.product === "string" ? sibling.product : sibling?.product?.id;
  const product = productId ?? (await stripe.products.create({ name: `Xenora ${plan.name}`, metadata: { plan: plan.key } })).id;
  const unit_amount = interval === "year" ? annualAmount(plan) * 100 : plan.amount * 100;
  const price = await stripe.prices.create({
    product,
    unit_amount,
    currency: "eur",
    recurring: { interval },
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
    // "interval" è opzionale (retrocompatibile con eventuali altri chiamanti): "month" (default) o "year".
    const interval: BillingInterval = body?.interval === "year" ? "year" : "month";

    const stripe = new Stripe(key);
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const price = await getPriceId(stripe, plan, interval);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      customer_email: body?.email || undefined,
      client_reference_id: body?.userId || undefined,
      allow_promotion_codes: true,
      subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { userId: body?.userId || "", plan: plan.key, interval } },
      metadata: { userId: body?.userId || "", plan: plan.key, interval },
      success_url: `${origin}/abbonamento?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/abbonamento?checkout=cancel`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
