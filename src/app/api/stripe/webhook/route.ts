import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook Stripe (Connect): fonte di verità per gli incassi. Registra la prenotazione/incasso
// sul server ANCHE se l'ospite chiude il browser prima del ritorno pagina. Idempotente.
// Richiede STRIPE_WEBHOOK_SECRET (firma) impostato su Vercel e un endpoint webhook configurato
// su Stripe con gli eventi Connect (checkout.session.completed, charge.refunded).
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !whSecret) return NextResponse.json({ ok: false, error: "webhook_not_configured" }, { status: 503 });

  const sig = req.headers.get("stripe-signature") || "";
  const raw = await req.text(); // corpo grezzo: necessario per verificare la firma
  const stripe = new Stripe(key);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, whSecret);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "bad_signature", message: (e as Error)?.message }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const m = (session.metadata ?? {}) as Record<string, string>;
      if (session.payment_status === "paid" && m.kind === "book" && m.slug) {
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id || "");
        // Registra la prenotazione (idempotente sul token) — stessa logica del ritorno pagina.
        await fetch(`${origin}/api/public-booking`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slug: m.slug, rt: m.rt, ci: m.ci, co: m.co,
            adults: Number(m.ad) || 1, children: Number(m.ch) || 0,
            total: Number(m.tot) || 0, deposit: Number(m.dep) || 0,
            note: m.note || "", code: m.code || "", token: m.token || session.id,
            planName: m.rpn || "", refundable: m.ref === "1", cancelDays: Number(m.cd) || 0,
            stripePaymentIntent: pi, stripeSessionId: session.id, stripeAccountId: event.account || "",
            guest: { firstName: (m.gn || "").split(" ")[0] || "", lastName: (m.gn || "").split(" ").slice(1).join(" "), email: m.ge || "", phone: m.gp || "", country: m.gc || "" },
          }),
        });
      }
      // I saldi pagati al check-in (kind "quote") vengono registrati dal ritorno pagina
      // (pay-confirm). Qui li lasciamo passare: la creazione prenotazione non serve.
    }

    if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      // Riconciliazione rimborsi/dispute: annota sull'ente giusto se ritroviamo il payment_intent.
      const ch = event.data.object as Stripe.Charge;
      const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : (ch.payment_intent?.id || "");
      if (pi) await reconcileRefund(pi, event.account || "", event.type === "charge.dispute.created");
    }

    return NextResponse.json({ ok: true, received: event.type });
  } catch (e) {
    // Non far ritentare all'infinito Stripe per errori nostri non critici: rispondi 200.
    return NextResponse.json({ ok: true, warning: (e as Error)?.message ?? "handler_error" });
  }
}

// Trova la prenotazione col dato payment_intent (in app_state o org_state) e annota rimborso/dispute.
async function reconcileRefund(paymentIntent: string, account: string, isDispute: boolean) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return;
  const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const DATA_KEY = "spigolestay:data:v1";
  type Json = Record<string, unknown>;
  const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
  const parse = (data: unknown): Json => { const b = ((data ?? {}) as Record<string, string>) || {}; try { return JSON.parse(b[DATA_KEY] || "{}") as Json; } catch { return {}; } };

  const patchInRow = async (table: "app_state" | "org_state", col: "user_id" | "org_id", val: string) => {
    const { data: row } = await admin.from(table).select("data, rev").eq(col, val).maybeSingle();
    if (!row) return false;
    const blob = (((row as { data?: unknown }).data ?? {}) as Record<string, string>) || {};
    const d = parse((row as { data?: unknown }).data);
    const bookings = arr(d.bookings);
    const idx = bookings.findIndex((b) => (b as { stripePaymentIntent?: string }).stripePaymentIntent === paymentIntent);
    if (idx < 0) return false;
    const bk = bookings[idx] as Json;
    if (isDispute) bookings[idx] = { ...bk, dispute: true, updatedAt: Date.now(), note: [String(bk.note || ""), "⚠ Dispute Stripe aperta"].filter(Boolean).join(" · ") };
    else bookings[idx] = { ...bk, status: "cancelled", cancelledBy: (bk.cancelledBy as string) || "host", cancelledAt: (bk.cancelledAt as string) || new Date().toISOString(), updatedAt: Date.now() };
    d.bookings = bookings;
    const nb = { ...blob, [DATA_KEY]: JSON.stringify(d) };
    const rev = (row as { rev?: number }).rev;
    let w = admin.from(table).update({ data: nb, updated_at: new Date().toISOString() }).eq(col, val);
    if (typeof rev === "number") w = w.eq("rev", rev);
    const { data: u } = await w.select("rev");
    return !!(u && u.length > 0);
  };

  // Cerca prima nelle org (le strutture in società tengono qui le prenotazioni), poi nei personali.
  const { data: orgs } = await admin.from("org_state").select("org_id").limit(1000);
  for (const o of arr(orgs)) { if (await patchInRow("org_state", "org_id", String((o as { org_id?: string }).org_id))) return; }
  // Restringi i personali a quelli collegati a questo conto Stripe se possibile.
  const { data: users } = await admin.from("app_state").select("user_id").limit(5000);
  for (const u of arr(users)) { if (await patchInRow("app_state", "user_id", String((u as { user_id?: string }).user_id))) return; }
  void account;
}
