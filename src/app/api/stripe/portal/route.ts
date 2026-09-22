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
    const open = () => stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/abbonamento` });
    try {
      const ps = await open();
      return NextResponse.json({ url: ps.url });
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      // Caso tipico in test: il Customer Portal non ha una configurazione salvata in Dashboard.
      // La creiamo al volo (default) e riproviamo, così l'apertura funziona senza passaggi manuali.
      if (/configuration/i.test(msg)) {
        await stripe.billingPortal.configurations.create({
          business_profile: { headline: "Xenora · Gestione abbonamento" },
          features: {
            invoice_history: { enabled: true },
            payment_method_update: { enabled: true },
            customer_update: { enabled: true, allowed_updates: ["email", "address", "name", "tax_id"] },
            subscription_cancel: { enabled: true, mode: "at_period_end" },
          },
        });
        const ps = await open();
        return NextResponse.json({ url: ps.url });
      }
      throw e;
    }
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
