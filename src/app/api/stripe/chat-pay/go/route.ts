import Stripe from "stripe";
import { NextResponse } from "next/server";
import { findBookingStoreForTenant } from "@/lib/manage-booking";
import { chatPayContext } from "@/lib/chat-pay";
import { withLiveStripe } from "@/lib/chat-pay-stripe";
import { fmtEur, planChatPayment, type ChatPayKind } from "@/lib/chat-pay-core";
import { paySecret, verifyPayToken } from "@/lib/chat-pay-token";
import { adminFromEnv, recordChatPayment } from "@/lib/chat-pay-server";
import { estimatedStripeFeeCents } from "@/lib/payments/fee";
import type { Booking, Structure } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Il pagamento dentro la chat" — lato OSPITE. Due ingressi sulla stessa route (pubblica):
//   GET ?t=<token firmato>          → ricontrolla la prenotazione, crea la sessione Stripe Checkout
//                                      (destination charge sul conto collegato della STRUTTURA) e
//                                      reindirizza l'ospite al pagamento con carta;
//   GET ?done=1&session_id=cs_…     → ritorno dopo il pagamento: verifica su Stripe che sia PAGATO e
//                                      registra l'incasso (idempotente, come fa il webhook).
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function page(title: string, body: string, status = 200, accent = "#285f92"): NextResponse {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f6f8;color:#1c2430;display:grid;place-items:center;min-height:100vh;padding:16px}
.c{max-width:420px;width:100%;background:#fff;border-radius:16px;padding:28px 24px;box-shadow:0 2px 14px rgba(0,0,0,.08);text-align:center}
h1{font-size:19px;margin:0 0 10px;color:${accent}}p{margin:8px 0;line-height:1.5;font-size:15px;color:#3b4553}.s{font-size:12px;color:#8a94a3;margin-top:18px}</style></head>
<body><div class="c"><h1>${esc(title)}</h1>${body}</div></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("done")) return handleDone(url);
  return handleStart(url);
}

async function handleStart(url: URL) {
  const token = url.searchParams.get("t") || "";
  const secret = paySecret();
  const key = process.env.STRIPE_SECRET_KEY;
  const admin = adminFromEnv();
  if (!secret || !key || !admin) return page("Pagamento non disponibile", `<p>Il pagamento online non è al momento disponibile. Contatta direttamente la struttura.</p>`, 503);

  const v = verifyPayToken(token, secret);
  if (!v.ok) return page("Link non valido", `<p>${v.error === "expired" ? "Questo link di pagamento è scaduto." : "Questo link di pagamento non è valido."} Chiedi alla struttura di inviartene uno nuovo.</p>`, 410);
  const { u: tenantId, b: bookingId, k: kind, c: maxCents } = v.payload;

  const store = await findBookingStoreForTenant(admin, tenantId, bookingId);
  if (!store) return page("Prenotazione non trovata", `<p>Non riusciamo a trovare la prenotazione. Contatta la struttura.</p>`, 404);
  const bk = store.booking as unknown as Booking;
  const st = (store.structure ?? undefined) as unknown as Structure | undefined;

  // Ricontrollo al momento del click: residuo reale, Stripe collegato, mai oltre il residuo
  // (se nel frattempo è stato incassato qualcosa, l'importo si riduce; non sale mai oltre il token).
  const plan = planChatPayment(await withLiveStripe(chatPayContext(bk, st)), kind as ChatPayKind, maxCents / 100, { clamp: true });
  if (!plan.ok) {
    if (plan.error === "already_paid" || plan.error === "tax_already_paid") return page("Già saldato", `<p>Per questa prenotazione non risulta nulla da pagare. Grazie!</p>`);
    if (plan.error === "stripe_not_connected") return page("Pagamento non disponibile", `<p>Il pagamento online non è attivo per questa struttura. Contatta direttamente la struttura.</p>`, 503);
    return page("Pagamento non disponibile", `<p>Non è possibile pagare online questa prenotazione. Contatta la struttura.</p>`, 400);
  }

  const structName = String(st?.name || "Struttura");
  const guest = (store.guest ?? {}) as { email?: string };
  const meta: Record<string, string> = {
    kind: "chatpay", bid: bookingId, uid: tenantId, pk: kind, sid: String(bk.structureId || ""),
    code: String((bk as { code?: string }).code || "").slice(0, 40),
  };
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || url.origin).replace(/\/+$/, "");
  const label = `${kind === "tassa" ? "Tassa di soggiorno" : "Saldo soggiorno"} · ${structName}`.slice(0, 250);
  const desc = `${bk.checkIn} → ${bk.checkOut}`;
  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      locale: "auto",
      line_items: [{ price_data: { currency: "eur", unit_amount: plan.cents, product_data: { name: label, description: desc } }, quantity: 1 }],
      customer_email: guest.email && guest.email.includes("@") ? guest.email : undefined,
      metadata: meta,
      // DESTINATION CHARGE come negli altri flussi: addebito sulla piattaforma, netto (meno stima commissione
      // Stripe) trasferito al conto collegato della STRUTTURA di questa prenotazione.
      payment_intent_data: {
        metadata: meta,
        transfer_data: { destination: String(st?.stripeAccount), amount: Math.max(0, plan.cents - estimatedStripeFeeCents(plan.cents)) },
        on_behalf_of: String(st?.stripeAccount),
      },
      success_url: `${origin}/api/stripe/chat-pay/go?done=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/api/stripe/chat-pay/go?t=${encodeURIComponent(token)}`,
    });
    if (!session.url) return page("Pagamento non disponibile", `<p>Non è stato possibile aprire il pagamento. Riprova tra poco.</p>`, 502);
    return NextResponse.redirect(session.url, 303);
  } catch (e) {
    console.error("[chat-pay go]", (e as Error)?.message);
    return page("Pagamento non disponibile", `<p>Non è stato possibile aprire il pagamento. Riprova tra poco o contatta la struttura.</p><p class="s">${esc(fmtEur(plan.cents))} · ${esc(structName)}</p>`, 502);
  }
}

async function handleDone(url: URL) {
  const sessionId = (url.searchParams.get("session_id") || "").trim();
  const key = process.env.STRIPE_SECRET_KEY;
  const admin = adminFromEnv();
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId) || !key || !admin) return page("Grazie", `<p>Se hai completato il pagamento, la struttura lo vedrà a breve.</p>`);
  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const m = (session.metadata ?? {}) as Record<string, string>;
    if (m.kind !== "chatpay") return page("Grazie", `<p>Se hai completato il pagamento, la struttura lo vedrà a breve.</p>`);
    if (session.payment_status !== "paid") return page("Pagamento non completato", `<p>Il pagamento non risulta completato. Puoi riaprire il link ricevuto in chat per riprovare.</p>`, 402);
    // Registra l'incasso (idempotente: se il webhook è già passato non cambia nulla).
    const r = await recordChatPayment(admin, session);
    if (!r.ok) console.error("[chat-pay done] registrazione non riuscita:", r.error, "session", sessionId);
    const amount = fmtEur(Math.round(session.amount_total ?? 0));
    return page("Pagamento ricevuto", `<p><b>${esc(amount)}</b> pagati con successo. Grazie!</p><p>${r.ok ? "La struttura ha ricevuto la conferma." : "La struttura vedrà il pagamento a breve."}</p><p class="s">Puoi chiudere questa pagina.</p>`, 200, "#2f8f5b");
  } catch (e) {
    console.error("[chat-pay done]", (e as Error)?.message);
    return page("Grazie", `<p>Se hai completato il pagamento, la struttura lo vedrà a breve.</p>`);
  }
}
