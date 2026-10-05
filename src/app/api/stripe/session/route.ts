import Stripe from "stripe";
import { requireUser, isErr } from "@/lib/server-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verifica una sessione di Checkout dopo il ritorno dal pagamento.
export async function GET(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  const who = await requireUser(req);
  if (isErr(who)) return who;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  try {
    const stripe = new Stripe(key);
    const s = await stripe.checkout.sessions.retrieve(id, { expand: ["subscription"] });
    // Solo la propria sessione di pagamento.
    if ((s.metadata?.userId || s.client_reference_id || "") !== who.userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const sub = s.subscription && typeof s.subscription !== "string" ? s.subscription : null;
    return NextResponse.json({
      status: s.status, // complete | open | expired
      paymentStatus: s.payment_status,
      plan: (s.metadata?.plan as string) || null,
      customerId: typeof s.customer === "string" ? s.customer : s.customer?.id ?? null,
      subscriptionStatus: sub?.status ?? null, // trialing | active | ...
    });
  } catch (e) {
    return NextResponse.json({ error: "stripe_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
