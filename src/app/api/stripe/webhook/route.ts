import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { handleSubscriptionPaid, type SubscriptionPaidInput } from "@/lib/invoicing/subscription-billing";
import { planByKey } from "@/lib/stripe-plans";

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

  const origin = req.headers.get("origin") || new URL(req.url).origin;
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

      // ABBONAMENTO Xenora (piattaforma): il checkout con trial NON incassa subito → nessuna
      // fattura qui. Loggo solo l'attivazione; la fatturazione parte da invoice.paid.
      if (!event.account && session.mode === "subscription") {
        console.log("[sub-invoicing] subscription checkout completata (attivazione/trial):", {
          userId: m.userId || session.client_reference_id || "", plan: m.plan || "",
          customer: typeof session.customer === "string" ? session.customer : session.customer?.id || "",
          email: session.customer_details?.email || session.customer_email || "",
        });
      }
    }

    // Pagamento di un abbonamento Xenora (rinnovo o primo addebito a fine trial).
    // Solo eventi della PIATTAFORMA (!event.account): gli abbonati stanno sul conto piattaforma.
    if (!event.account && (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded")) {
      const input = await subscriptionInputFromInvoice(stripe, event.data.object as Stripe.Invoice);
      if (input) await handleSubscriptionPaid(input, { origin });
    }

    if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      // Riconciliazione rimborsi/dispute: annota sull'ente giusto se ritroviamo il payment_intent.
      const ch = event.data.object as Stripe.Charge;
      const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : (ch.payment_intent?.id || "");
      if (pi) await reconcileRefund(pi, event.account || "", event.type === "charge.dispute.created");
    }

    // Avvisi al TITOLARE per eventi importanti di abbonamento/fatturazione della PIATTAFORMA (!event.account).
    // Best-effort: mai far fallire il webhook. Riguarda solo gli abbonati Xenora (conto piattaforma).
    if (!event.account) {
      try {
        // 1) Nuovo abbonato Xenora.
        if (event.type === "customer.subscription.created") {
          const sub = event.data.object as Stripe.Subscription;
          const email = await customerEmail(stripe, sub.customer);
          const item0 = sub.items?.data?.[0];
          const price = item0?.price;
          const importo = typeof price?.unit_amount === "number"
            ? `${(price.unit_amount / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })} ${(price.currency || "eur").toUpperCase()}${price.recurring?.interval ? `/${price.recurring.interval}` : ""}`
            : "";
          const piano = sub.metadata?.plan || price?.nickname || price?.id || "";
          const text = [
            "Nuovo abbonamento Xenora attivato.",
            email ? `Cliente: ${email}` : "",
            piano ? `Piano: ${piano}` : "",
            importo ? `Importo: ${importo}` : "",
            `Stato: ${sub.status}`,
          ].filter(Boolean).join("\n");
          await notifyAdmins(origin, "Nuovo abbonato Xenora", text);
        }

        // 2) Pagamento fallito.
        if (event.type === "invoice.payment_failed") {
          const inv = event.data.object as Stripe.Invoice;
          const a = inv as unknown as { customer?: string | { id?: string } | null; customer_email?: string | null; amount_due?: number | null; number?: string | null; hosted_invoice_url?: string | null; currency?: string | null };
          const email = a.customer_email || await customerEmail(stripe, a.customer ?? null);
          const importo = typeof a.amount_due === "number" ? `${(a.amount_due / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })} ${(a.currency || "eur").toUpperCase()}` : "";
          const text = [
            "Il pagamento di un abbonamento Xenora è FALLITO.",
            email ? `Cliente: ${email}` : "",
            importo ? `Importo dovuto: ${importo}` : "",
            a.number ? `Fattura: ${a.number}` : "",
            a.hosted_invoice_url ? `Link fattura: ${a.hosted_invoice_url}` : "",
          ].filter(Boolean).join("\n");
          await notifyAdmins(origin, "⚠ Pagamento fallito", text);
        }

        // 3) Disdetta abbonamento: cancellazione immediata oppure impostata a fine periodo.
        const isCancelNow = event.type === "customer.subscription.deleted";
        const isCancelScheduled = event.type === "customer.subscription.updated"
          && (() => {
            const sub = event.data.object as Stripe.Subscription;
            const prev = (event.data as unknown as { previous_attributes?: { cancel_at_period_end?: boolean } }).previous_attributes;
            return sub.cancel_at_period_end === true && prev?.cancel_at_period_end === false;
          })();
        if (isCancelNow || isCancelScheduled) {
          const sub = event.data.object as Stripe.Subscription;
          const email = await customerEmail(stripe, sub.customer);
          const fineUnix = (sub as unknown as { current_period_end?: number | null; cancel_at?: number | null }).cancel_at
            ?? (sub as unknown as { current_period_end?: number | null }).current_period_end
            ?? null;
          const fine = fineUnix ? (() => { try { return new Date(fineUnix * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }); } catch { return ""; } })() : "";
          const text = [
            isCancelNow ? "Un abbonamento Xenora è stato disdetto (cancellato)." : "Un abbonamento Xenora è stato impostato per la disdetta a fine periodo.",
            email ? `Cliente: ${email}` : "",
            fine ? `Fine periodo/servizio: ${fine}` : "",
          ].filter(Boolean).join("\n");
          await notifyAdmins(origin, "Disdetta abbonamento", text);
        }
      } catch { /* avvisi best-effort: non bloccare mai il webhook */ }
    }

    // Sincronizza lo stato abbonamento nella riga `profiles` del cliente (match su stripe_customer_id)
    // così il back-office legge l'elenco dal DB senza interrogare Stripe per ogni utente.
    // Best-effort: non deve MAI far fallire il webhook (né toccare la logica esistente sopra).
    if (!event.account) {
      try {
        if (event.type === "customer.subscription.created"
          || event.type === "customer.subscription.updated"
          || event.type === "customer.subscription.deleted") {
          await syncProfileFromSubscription(event.data.object as Stripe.Subscription, event.type === "customer.subscription.deleted");
        } else if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
          await syncProfileFromInvoice(stripe, event.data.object as Stripe.Invoice);
        }
      } catch { /* sync profilo best-effort: non bloccare il webhook */ }
    }

    return NextResponse.json({ ok: true, received: event.type });
  } catch (e) {
    // Non far ritentare all'infinito Stripe per errori nostri non critici: rispondi 200.
    return NextResponse.json({ ok: true, warning: (e as Error)?.message ?? "handler_error" });
  }
}

// Normalizza una Invoice Stripe di ABBONAMENTO nell'input per la fatturazione.
// Ritorna null se non è una fattura di subscription (così non tocchiamo altre fatture).
async function subscriptionInputFromInvoice(stripe: Stripe, inv: Stripe.Invoice): Promise<SubscriptionPaidInput | null> {
  // Alcuni campi variano per versione API: accesso difensivo.
  const a = inv as unknown as {
    id?: string; subscription?: string | { id?: string } | null; customer?: string | { id?: string } | null;
    customer_email?: string | null; total?: number | null; subtotal?: number | null; tax?: number | null;
    amount_paid?: number | null; currency?: string | null; billing_reason?: string | null;
    period_start?: number | null; period_end?: number | null;
    lines?: { data?: { period?: { start?: number; end?: number } | null; price?: { metadata?: Record<string, string> } | null }[] };
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
  };

  const subRef = a.subscription ?? a.parent?.subscription_details?.subscription ?? null;
  const subId = typeof subRef === "string" ? subRef : (subRef?.id ?? null);
  const isSub = !!subId || (a.billing_reason || "").startsWith("subscription");
  if (!isSub) return null; // non è una fattura di abbonamento: ignora

  const custId = typeof a.customer === "string" ? a.customer : (a.customer?.id ?? null);
  const line0 = a.lines?.data?.[0];
  const periodStart = line0?.period?.start ?? a.period_start ?? null;
  const periodEnd = line0?.period?.end ?? a.period_end ?? null;

  // Metadata (userId/plan): dalla subscription se disponibile, altrimenti dal price della riga.
  let plan: string | null = line0?.price?.metadata?.plan ?? null;
  let userId: string | null = null;
  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      userId = sub.metadata?.userId || null;
      plan = sub.metadata?.plan || plan;
    } catch { /* metadata non disponibili: si salterà con motivo lato lib */ }
  }
  const planName = plan ? (planByKey(plan)?.name ?? null) : null;

  return {
    stripeInvoiceId: a.id || "",
    stripeSubscriptionId: subId,
    stripeCustomerId: custId,
    subscriberUserId: userId,
    subscriberEmail: a.customer_email ?? null,
    plan, planName,
    periodStart, periodEnd,
    totalCents: (a.total ?? a.amount_paid ?? 0) || 0,
    subtotalCents: a.subtotal ?? null,
    taxCents: a.tax ?? null,
    currency: a.currency ?? "eur",
  };
}

// Recupera l'email del cliente Stripe gestendo il caso di customer cancellato (DeletedCustomer).
async function customerEmail(stripe: Stripe, customer: string | { id?: string } | null | undefined): Promise<string> {
  const id = typeof customer === "string" ? customer : (customer?.id || "");
  if (!id) return "";
  try {
    const c = await stripe.customers.retrieve(id);
    if ((c as { deleted?: boolean }).deleted) return "";
    return (c as Stripe.Customer).email || "";
  } catch { return ""; }
}

// Avvisa il TITOLARE (tutti gli indirizzi in ADMIN_EMAILS) inviando un'email semplice via /api/email.
// Best-effort: se RESEND non è configurato fallisce silenziosamente. Non deve mai propagare errori.
async function notifyAdmins(origin: string, subject: string, text: string) {
  const admins = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
    .split(",").map((s) => s.trim()).filter(Boolean);
  for (const to of admins) {
    try {
      await fetch(`${origin}/api/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "quote", to, subject, text, accent: "#285f92" }),
      });
    } catch { /* invio best-effort: ignora */ }
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

// Aggiorna la riga `profiles` del cliente con lo stato dell'abbonamento (per il back-office scalabile:
// l'elenco si legge dal DB, senza chiamare Stripe per ogni riga). Best-effort.
async function syncProfileFromSubscription(sub: Stripe.Subscription, deleted: boolean) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return;
  const custId = typeof sub.customer === "string" ? sub.customer : (sub.customer?.id || "");
  if (!custId) return;

  const item0 = sub.items?.data?.[0];
  const price = item0?.price;
  const amt = typeof price?.unit_amount === "number" ? price.unit_amount : null;
  const interval = price?.recurring?.interval;
  const monthlyCents = amt == null ? null : (interval === "year" ? Math.round(amt / 12) : amt);
  const periodEndUnix = (item0 as unknown as { current_period_end?: number })?.current_period_end
    ?? (sub as unknown as { current_period_end?: number })?.current_period_end
    ?? null;
  const planKey = sub.metadata?.plan
    || (price?.metadata as Record<string, string> | undefined)?.plan
    || null;

  const patch: Record<string, unknown> = {
    subscription_status: deleted ? "canceled" : sub.status,
    current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
    monthly_amount_cents: monthlyCents,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    sub_currency: price?.currency ?? null,
    sub_updated_at: new Date().toISOString(),
  };
  if (planKey) patch.plan = planKey; // se il piano non è ricavabile, lascia invariato

  const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
  await admin.from("profiles").update(patch).eq("stripe_customer_id", custId);
}

// invoice.paid / invoice.payment_succeeded: recupera la subscription (se presente) e riusa
// syncProfileFromSubscription per riflettere il nuovo periodo/importo nella riga `profiles`.
async function syncProfileFromInvoice(stripe: Stripe, inv: Stripe.Invoice) {
  const a = inv as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
  };
  const subRef = a.subscription ?? a.parent?.subscription_details?.subscription ?? null;
  const subId = typeof subRef === "string" ? subRef : (subRef?.id ?? null);
  if (!subId) return; // fattura non di abbonamento: niente da sincronizzare
  const sub = await stripe.subscriptions.retrieve(subId);
  await syncProfileFromSubscription(sub, false);
}
