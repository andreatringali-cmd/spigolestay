import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { findBookingStoreForTenant } from "@/lib/manage-booking";
import { chatPayContext } from "@/lib/chat-pay";
import { withLiveStripe } from "@/lib/chat-pay-stripe";
import { planChatPayment, type ChatPayKind } from "@/lib/chat-pay-core";
import { PAY_TOKEN_TTL_DAYS, paySecret, signPayToken } from "@/lib/chat-pay-token";
import type { Booking, Structure } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Il pagamento dentro la chat" — passo 1: il GESTORE (autenticato) chiede un link di pagamento
// per una prenotazione. Qui si controlla TUTTO (accesso alla prenotazione, Stripe collegato per
// QUELLA struttura, residuo, importo mai oltre il residuo) e si restituisce un link firmato di
// Xenora da incollare nel messaggio. La sessione Stripe Checkout (destination charge sul conto
// collegato della struttura) viene creata quando l'ospite apre il link: così non scade in 24 ore.
// Questa route NON addebita nulla e non crea sessioni Stripe.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const bookingId = String(b?.bookingId || "").trim();
    const kind: ChatPayKind = b?.kind === "tassa" ? "tassa" : "saldo";
    if (!bookingId) return NextResponse.json({ error: "missing_booking", message: "Prenotazione mancante." }, { status: 400 });
    const hasAmount = b?.amount !== undefined && b?.amount !== null && b?.amount !== "";
    const requested = hasAmount ? Number(b.amount) : undefined;

    const secret = paySecret();
    if (!secret) return NextResponse.json({ error: "pay_link_not_configured", message: "Link di pagamento non configurato sul server (manca CRED_SECRET o CHAT_PAY_SECRET)." }, { status: 503 });
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "stripe_not_configured", message: "Stripe non è configurato sul server." }, { status: 503 });

    const store = await findBookingStoreForTenant(auth.admin, auth.tenantId, bookingId);
    if (!store) return NextResponse.json({ error: "booking_not_found", message: "Prenotazione non trovata sul server: se l'hai appena creata, riprova tra qualche secondo." }, { status: 404 });

    const ctx = await withLiveStripe(chatPayContext(store.booking as unknown as Booking, (store.structure ?? undefined) as unknown as Structure | undefined));
    const plan = planChatPayment(ctx, kind, requested);
    if (!plan.ok) return NextResponse.json({ error: plan.error, message: plan.message, maxAmount: plan.maxCents != null ? plan.maxCents / 100 : undefined }, { status: 400 });

    const exp = Math.floor(Date.now() / 1000) + PAY_TOKEN_TTL_DAYS * 86400;
    const token = signPayToken({ u: auth.tenantId, b: bookingId, k: kind, c: plan.cents, e: exp }, secret);
    const origin = (process.env.NEXT_PUBLIC_SITE_URL || req.headers.get("origin") || new URL(req.url).origin).replace(/\/+$/, "");
    return NextResponse.json({
      ok: true,
      url: `${origin}/api/stripe/chat-pay/go?t=${token}`,
      amount: plan.cents / 100,
      maxAmount: plan.maxCents / 100,
      kind,
      expiresAt: exp * 1000,
    });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
