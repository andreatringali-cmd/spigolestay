import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recupera il cliente Stripe dell'ABBONAMENTO XENORA (non un cliente qualsiasi con la stessa
// email nel tuo account Stripe). Un abbonato Xenora ha una subscription con metadata.plan
// (impostata al checkout in /api/stripe/checkout) e, quando disponibile, metadata.userId.
export async function GET(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });

  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  const userId = url.searchParams.get("userId") || "";
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  try {
    const stripe = new Stripe(key);
    const list = await stripe.customers.list({ email, limit: 20 });
    if (!list.data.length) return NextResponse.json({ customerId: null, hasCard: false, subscriptionStatus: null });

    // Tra i clienti con questa email, scegli SOLO l'abbonamento Xenora migliore:
    // priorità a quello del MIO utente (metadata.userId) e a uno stato "vivo" (active/trialing/past_due),
    // così un vecchio sub annullato o incompleto non fa vincere lo stato sbagliato.
    const LIVE = new Set(["active", "trialing", "past_due"]);
    let chosen: Stripe.Customer | null = null;
    let chosenSub: Stripe.Subscription | null = null;
    let chosenScore = -1;
    for (const c of list.data) {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 20 });
      for (const s of subs.data) {
        if (!s.metadata?.plan) continue; // solo abbonamenti Xenora
        const mine = !!userId && (s.metadata?.userId || "") === userId;
        const live = LIVE.has(s.status);
        const score = (mine ? 2 : 0) + (live ? 1 : 0);
        if (score > chosenScore) { chosenScore = score; chosen = c; chosenSub = s; }
      }
    }
    // Nessun abbonamento Xenora: NON restituire un cliente estraneo (es. un tuo cliente omonimo).
    if (!chosen) return NextResponse.json({ customerId: null, hasCard: false, subscriptionStatus: null, foreignEmailMatch: list.data.length > 0 });

    const defaultPm = chosen.invoice_settings?.default_payment_method || null;
    const pms = await stripe.paymentMethods.list({ customer: chosen.id, type: "card", limit: 1 });
    const hasCard = !!defaultPm || pms.data.length > 0;

    return NextResponse.json({ customerId: chosen.id, hasCard, subscriptionStatus: chosenSub?.status ?? null });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
