import Stripe from "stripe";
import { siteOrigin } from "@/lib/server-auth";
import { internalFetch } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { handleSubscriptionPaid, type SubscriptionPaidInput } from "@/lib/invoicing/subscription-billing";
import { planByKey } from "@/lib/stripe-plans";
import { adminFromEnv, recordChatPayment } from "@/lib/chat-pay-server";
import { publicBookingBodyFromSession, bookingWriteFailure } from "@/lib/book-session";
import { findOwnerStructure } from "@/lib/server-booking-guard";
import { registerQuotePayment } from "@/lib/quote-pay";
import { recordCheckinPayment } from "@/lib/checkin-pay";
import { findBookingStoreById } from "@/lib/manage-booking";
import { reconcileCharge } from "@/lib/stripe-reconcile";
import { fmtDMY } from "@/lib/dates";
import { ymdRome } from "@/lib/dates-rome";
import { eur } from "@/lib/format";

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

  const origin = siteOrigin(req);
  try {
    // Pagamento completato. Con le sole carte arriva "completed"; "async_payment_succeeded" copre i metodi asincroni (bonifico, SEPA) se mai attivati.
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      const m = (session.metadata ?? {}) as Record<string, string>;
      if (session.payment_status === "paid" && m.kind === "book" && m.slug) {
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id || "");
        // Destination charge: l'evento è sulla piattaforma (event.account vuoto). Il conto della struttura
        // si ricava dal payment_intent (transfer_data.destination) per salvarlo sulla prenotazione. Best-effort.
        let acctId = event.account || "";
        if (!acctId && pi) {
          try {
            const pIntent = await stripe.paymentIntents.retrieve(pi);
            const dest = pIntent.transfer_data?.destination;
            acctId = typeof dest === "string" ? dest : (dest?.id || "");
          } catch { /* il rimborso non dipende da questo dato */ }
        }
        // Registra la prenotazione (idempotente sul token) — stessa logica del ritorno pagina.
        const pbRes = await internalFetch(`${origin}/api/public-booking`, {
          method: "POST", headers: { "content-type": "application/json" },
          // Stesso corpo del ritorno pagina (lib/book-session.ts); versato = quanto Stripe ha incassato.
          body: JSON.stringify(publicBookingBodyFromSession(session, { slug: m.slug, paymentIntent: pi, accountId: acctId })),
        });
        // Pagamento incassato ma prenotazione non scritta. Guasto TRANSITORIO (rete, 5xx, 409 write_conflict): errore, così Stripe riprova (la scrittura è idempotente).
        // Errore PERMANENTE (4xx: sito/struttura non trovati, richiesta incoerente…): riprovare non cambia nulla, quindi niente 500 per giorni — si avvisano titolare
        // e amministratori con tutti i dati del pagamento. Nessun rimborso automatico: è irreversibile e i dati si possono sistemare a mano; decide una persona.
        if (!pbRes.ok) {
          const pbj = await pbRes.json().catch(() => ({}));
          const fail = bookingWriteFailure(pbRes.status, pbj);
          if (!fail.permanent) return NextResponse.json({ ok: false, error: "booking_write_failed" }, { status: 500 });
          console.error("[stripe webhook] pagamento incassato ma prenotazione NON registrabile (errore permanente):", fail.error, "session", session.id);
          await alertPaidNotRecorded(origin, session, pi, fail.error);
        }
      }
      // Link di pagamento in chat (kind "chatpay"): registra l'incasso sulla prenotazione e scrive
      // "Pagamento ricevuto" nel thread. Idempotente (paidSessions + id messaggio pay:<sessione>),
      // quindi sicuro anche se arriva prima/dopo la pagina di ritorno. Se fallisce → 500 e Stripe ritenta.
      if (session.payment_status === "paid" && m.kind === "chatpay") {
        const admin = adminFromEnv();
        if (!admin) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
        const rec = await recordChatPayment(admin, session);
        if (!rec.ok) return NextResponse.json({ ok: false, error: "chatpay_record_failed", detail: rec.error }, { status: 500 });
      }
      // Pagamenti di un preventivo e saldi dal check-in (kind "quote"): si registrano anche qui, con la STESSA logica idempotente del ritorno pagina
      // (quote/confirm e checkin/pay-confirm), così l'incasso non si perde se l'ospite chiude il browser prima del ritorno.
      if (session.payment_status === "paid" && m.kind === "quote") {
        const admin = adminFromEnv();
        if (!admin) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
        // La sessione con il payment intent espanso: serve a sapere su quale conto è arrivato il pagamento.
        const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ["payment_intent"] });
        if (m.bookingId) {
          const store = await findBookingStoreById(admin, m.bookingId);
          // Prenotazione non trovata: errore definitivo per questo evento (niente retry infiniti); resta il ritorno pagina.
          if (store) {
            const r = await recordCheckinPayment(admin, store, full as never, { origin });
            if (!r.ok && (r.status >= 500 || r.error === "write_conflict" || r.error === "refund_failed")) return NextResponse.json({ ok: false, error: "checkin_record_failed", detail: r.error }, { status: 500 });
            if (!r.ok) console.error("[stripe webhook] saldo check-in non registrato:", r.error, "session", session.id);
          }
        } else {
          const r = await registerQuotePayment(admin, full as never, { origin });
          if (!r.ok && (r.status >= 500 || r.error === "write_conflict")) return NextResponse.json({ ok: false, error: "quote_record_failed", detail: r.error }, { status: 500 });
          if (!r.ok) console.error("[stripe webhook] preventivo non registrato:", r.error, "session", session.id);
        }
      }

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
      const isDispute = event.type === "charge.dispute.created";
      if (pi) {
        const admin = adminFromEnv();
        if (admin) {
          const res = await reconcileCharge(admin, ch, pi, isDispute, async () => ({ ...((await stripe.paymentIntents.retrieve(pi)).metadata ?? {}) }));
          // Prenotazione trovata ma scrittura non riuscita (conflitto di versione): 500 così Stripe ritenta l'evento.
          if (res === "failed") return NextResponse.json({ ok: false, error: "reconcile_write_failed" }, { status: 500 });
        }
      }
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
            ? `${eur(price.unit_amount / 100, (price.currency || "eur").toLowerCase() === "eur" ? "€" : (price.currency || "eur").toUpperCase())}${price.recurring?.interval ? `/${({ month: "mese", year: "anno", week: "settimana", day: "giorno" } as Record<string, string>)[price.recurring.interval] ?? price.recurring.interval}` : ""}`
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
          const importo = typeof a.amount_due === "number" ? eur(a.amount_due / 100, (a.currency || "eur").toLowerCase() === "eur" ? "€" : (a.currency || "eur").toUpperCase()) : "";
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
          const fine = fineUnix ? (() => { try { return fmtDMY(ymdRome(fineUnix * 1000)); } catch { return ""; } })() : "";
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
    // Errore INATTESO in un passaggio (rete, database…): rispondi 500 così Stripe ritenta (con backoff, fino a ~3 giorni).
    // Verificato che i passaggi che possono lanciare sono idempotenti, quindi un nuovo tentativo non crea doppioni:
    //  - prenotazione dal sito: /api/public-booking è idempotente sul token/sessione (extId) → "already";
    //  - incasso in chat: recordChatPayment è idempotente (booking.paidSessions + id messaggio pay:<sessione>);
    //  - fattura abbonamento: handleSubscriptionPaid fa un "claim" con vincolo unico su stripe_invoice_id (ripetizione = "duplicate");
    //  - rimborso/dispute: scrittura unica con rev-lock sulla prenotazione (stato "cancelled" già impostato resta tale).
    // Gli avvisi email e la sincronizzazione del profilo hanno già il loro try/catch best-effort e non arrivano qui.
    console.error("[stripe webhook] errore inatteso, risposta 500 per il retry di Stripe:", event.type, event.id, e);
    return NextResponse.json({ ok: false, error: "handler_error", message: (e as Error)?.message ?? "handler_error" }, { status: 500 });
  }
}

// Avviso: una prenotazione dal sito e' stata PAGATA ma non si riesce a registrarla (errore permanente). Va al titolare della struttura (se si ricava dallo slug)
// e agli amministratori. Best-effort: non deve mai far fallire il webhook.
async function alertPaidNotRecorded(origin: string, session: Stripe.Checkout.Session, pi: string, error: string) {
  const m = (session.metadata ?? {}) as Record<string, string>;
  const amount = (Math.round(session.amount_total ?? 0) / 100).toFixed(2).replace(".", ",");
  const text = [
    "⚠ Un ospite ha PAGATO online ma la prenotazione NON è stata registrata nel gestionale.",
    `Importo incassato: € ${amount}`,
    `Ospite: ${m.gn || "—"}${m.ge ? ` · ${m.ge}` : ""}${m.gp ? ` · ${m.gp}` : ""}`,
    `Date: ${m.ci || "?"} → ${m.co || "?"} · Sito: ${m.slug || "?"}`,
    `Motivo: ${error}`,
    `Sessione Stripe: ${session.id}${pi ? ` · Payment intent: ${pi}` : ""}`,
    "Registra la prenotazione a mano oppure rimborsa il pagamento dalla dashboard Stripe.",
  ].join("\n");
  const subject = "⚠ Pagamento ricevuto ma prenotazione non registrata";
  try {
    const admin = adminFromEnv();
    if (admin && m.slug) {
      const { data: site } = await admin.from("public_sites").select("user_id, structure_id").eq("slug", m.slug).maybeSingle();
      const uid = String((site as { user_id?: string } | null)?.user_id || ""), sid = String((site as { structure_id?: string } | null)?.structure_id || "");
      const st = uid && sid ? await findOwnerStructure(admin, uid, sid) : null;
      const hostEmail = typeof st?.email === "string" ? st.email : "";
      if (hostEmail) await internalFetch(`${origin}/api/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "quote", to: hostEmail, subject, text, accent: "#b4472e" }) });
    }
  } catch { /* avviso al titolare best-effort */ }
  try { await notifyAdmins(origin, subject, text); } catch { /* idem */ }
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
      await internalFetch(`${origin}/api/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "quote", to, subject, text, accent: "#285f92" }),
      });
    } catch { /* invio best-effort: ignora */ }
  }
}

// Mappa configurabile price.id → chiave piano, letta da STRIPE_PRICE_MAP (JSON), es.
// {"price_xxx":"basic","price_yyy":"pro","price_zzz":"ultimate"}. Usata SOLO come fallback quando
// il piano non è nei metadata (né della subscription né del price). Parsing difensivo e memoizzato.
let _priceMapCache: Record<string, string> | null = null;
function planFromPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  if (_priceMapCache === null) {
    try {
      const parsed = JSON.parse(process.env.STRIPE_PRICE_MAP || "{}") as Record<string, unknown>;
      _priceMapCache = {};
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") _priceMapCache[k] = v;
    } catch { _priceMapCache = {}; }
  }
  return _priceMapCache[priceId] || null;
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
    || planFromPriceId(price?.id)   // FIX 3: fallback via STRIPE_PRICE_MAP (price.id → piano)
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
