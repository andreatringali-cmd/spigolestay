import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { siteOrigin, rateLimited } from "@/lib/server-auth";
import { clientIp } from "@/lib/server-booking-guard";
import { registerQuotePayment } from "@/lib/quote-pay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scrittura di RITORNO dopo il pagamento di un preventivo.
// L'ospite paga sul link pubblico /preventivo; al rientro (?paid=1&session_id=…) questa route:
//  1) verifica su Stripe che la sessione sia davvero PAGATA;
//  2) legge dai metadata della sessione (scritti dal server in /api/stripe/quote, non dal browser) i dati della prenotazione + l'id utente del proprietario;
//  3) registra nella riga app_state del proprietario (service role) una PRENOTAZIONE confermata, in modo IDEMPOTENTE (dedup sulla sessione Stripe
//     e sul preventivo): la stessa logica gira anche dal webhook Stripe, così l'incasso si registra anche se l'ospite chiude il browser.
// Il client del proprietario, alla prima sincronizzazione, vede la nuova prenotazione e quindi compare in calendario.
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  if (rateLimited("qcf:" + clientIp(req), 30, 60_000)) return NextResponse.json({ error: "troppe_richieste" }, { status: 429 });

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body?.session_id || "").trim();
    if (!sessionId) return NextResponse.json({ error: "missing_session" }, { status: 400 });

    // Con i destination charge la sessione è sull'account PIATTAFORMA: si recupera sempre senza stripeAccount header.
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (session.payment_status !== "paid") return NextResponse.json({ error: "not_paid", status: session.payment_status }, { status: 402 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await registerQuotePayment(admin, session as never, { origin: siteOrigin(req) });
    if (!r.ok) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
    return NextResponse.json({ ok: true, ...(r.already ? { already: true } : {}), ...(r.duplicateRefunded ? { duplicateRefunded: true } : {}) });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
