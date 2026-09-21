import { NextResponse } from "next/server";
import Stripe from "stripe";
import { authTenant, isResponse } from "@/lib/invoicing/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conferma pagamento ordine forniture (ritorno da Stripe): verifica la sessione
// e segna l'ordine come pagato. Idempotente (se già pagato, ok).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const sessionId = String(body?.session_id || "").trim();
  const orderId = String(body?.order || "").trim();
  if (!sessionId || !orderId) return NextResponse.json({ error: "missing_params" }, { status: 400 });

  // L'ordine deve appartenere al tenant.
  const { data: order } = await auth.admin.from("supply_orders").select("id, status").eq("id", orderId).eq("tenant_id", auth.tenantId).maybeSingle();
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  if (order.status === "paid" || order.status === "processing" || order.status === "shipped" || order.status === "delivered") return NextResponse.json({ ok: true, already: true });

  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return NextResponse.json({ error: "not_paid", status: session.payment_status }, { status: 402 });
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
    await auth.admin.from("supply_orders").update({ status: "paid", stripe_payment_intent_id: pi, updated_at: new Date().toISOString() }).eq("id", orderId).eq("tenant_id", auth.tenantId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message }, { status: 500 });
  }
}
