import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crea una sessione di Checkout una tantum per il pagamento (o acconto) di un preventivo.
// L'importo arriva dal preventivo; i dati della prenotazione viaggiano nei metadata (per il futuro webhook).
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  try {
    const body = await req.json().catch(() => ({}));
    const amount = Math.round(Number(body?.amount) || 0); // in euro
    if (amount <= 0) return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
    const label = String(body?.label || "Prenotazione").slice(0, 250);
    const email = typeof body?.email === "string" ? body.email : undefined;
    const meta: Record<string, string> = {};
    if (body?.metadata && typeof body.metadata === "object") {
      for (const [k, v] of Object.entries(body.metadata)) meta[k.slice(0, 40)] = String(v ?? "").slice(0, 480);
    }
    const acct = typeof body?.acct === "string" && body.acct.startsWith("acct_") ? body.acct : "";
    const stripe = new Stripe(key);
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const success = String(body?.successUrl || `${origin}/preventivo`);
    const cancel = String(body?.cancelUrl || `${origin}/preventivo`);
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: [{ price_data: { currency: "eur", unit_amount: amount * 100, product_data: { name: label } }, quantity: 1 }],
      metadata: { kind: "quote", ...meta },
      payment_intent_data: { metadata: { kind: "quote", ...meta } },
      customer_email: email,
      success_url: success.includes("{CHECKOUT_SESSION_ID}") ? success : `${success}${success.includes("?") ? "&" : "?"}paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel,
    };
    // Stripe Connect: se la struttura ha un account collegato, l'incasso va DIRETTAMENTE su quell'account.
    const session = acct
      ? await stripe.checkout.sessions.create(params, { stripeAccount: acct })
      : await stripe.checkout.sessions.create(params);
    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
