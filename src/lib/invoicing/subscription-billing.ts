// Fatturazione degli ABBONATI Xenora: quando un B&B paga l'abbonamento (Stripe
// subscription), Xenora è l'EMITTENTE e l'abbonato è il CLIENTE. Tutto GATED da
// SUB_INVOICING_LIVE: con il gate OFF (default) siamo in DRY-RUN → si calcola e
// si logga soltanto, nessuna email inviata, nessun documento creato, nessuna
// riga scritta in DB. NON viene MAI effettuata la trasmissione allo SdI: il
// documento resta in stato "bozza" (da inviare a mano quando il provider sarà pronto).
//
// Emittente Xenora = tenant_invoice_settings del "tenant piattaforma"
//   (env XENORA_PLATFORM_TENANT_ID). Se manca, si salta e si registra il motivo.
// Cliente = tenant_invoice_settings dell'abbonato (dati raccolti in abbonamento/pagamento).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildDocumentDraft, toCents, type FolioLine, type Regime } from "./folio";

// Input normalizzato ricavato dall'evento Stripe (invoice.paid / checkout subscription).
export interface SubscriptionPaidInput {
  stripeInvoiceId: string;             // chiave di idempotenza
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  subscriberUserId?: string | null;    // utente Xenora (metadata.userId)
  subscriberEmail?: string | null;
  plan?: string | null;                // basic|pro|ultimate
  planName?: string | null;            // etichetta leggibile (Basic/Pro/…)
  periodStart?: number | null;         // unix seconds
  periodEnd?: number | null;
  totalCents: number;                  // totale pagato (lordo) in centesimi
  subtotalCents?: number | null;       // imponibile se Stripe lo calcola
  taxCents?: number | null;            // IVA se Stripe la calcola
  currency?: string | null;
}

export interface SubscriptionPaidResult {
  ok: boolean;
  live: boolean;
  action: "dry_run" | "duplicate" | "draft_created" | "skipped" | "error";
  reason?: string;
  documentId?: string | null;
  emailSent: boolean;
  logId?: string | null;
}

// Gate globale: nessuna email/fattura reale finché non è esplicitamente attivo.
export function subInvoicingLive(): boolean {
  const v = (process.env.SUB_INVOICING_LIVE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

const dmy = (unixSec?: number | null) => {
  if (!unixSec) return "";
  try { const d = new Date(unixSec * 1000); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; } catch { return ""; }
};
const iso = (unixSec?: number | null) => (unixSec ? new Date(unixSec * 1000).toISOString() : null);

type Settings = {
  regime?: string; denominazione?: string; vat?: string; tax_code?: string;
  address?: string; city?: string; cap?: string; province?: string; country?: string;
  pec?: string; sdi?: string; default_provider?: string; rounding?: boolean;
};

async function loadSettings(admin: SupabaseClient, tenantId: string): Promise<Settings | null> {
  const { data } = await admin.from("tenant_invoice_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  return (data as Settings) ?? null;
}

// Orchestratore: dedup → email ricevuta → bozza fattura → log. Usato dal webhook.
export async function handleSubscriptionPaid(
  input: SubscriptionPaidInput,
  opts: { origin?: string } = {},
): Promise<SubscriptionPaidResult> {
  const live = subInvoicingLive();

  // DRY-RUN: nessun effetto collaterale, solo log.
  if (!live) {
    console.log("[sub-invoicing] DRY-RUN (SUB_INVOICING_LIVE off) — nessun invio/creazione:", {
      stripeInvoiceId: input.stripeInvoiceId, plan: input.plan, subscriberUserId: input.subscriberUserId,
      subscriberEmail: input.subscriberEmail, totalCents: input.totalCents,
      period: `${dmy(input.periodStart)} → ${dmy(input.periodEnd)}`,
    });
    return { ok: true, live: false, action: "dry_run", emailSent: false };
  }

  const admin = adminClient();
  if (!admin) { console.warn("[sub-invoicing] supabase non configurato"); return { ok: false, live, action: "error", reason: "supabase_not_configured", emailSent: false }; }

  // Dedup atomico: "claim" della riga con vincolo unico su stripe_invoice_id.
  const { data: claimed } = await admin
    .from("subscription_invoice_log")
    .upsert({
      stripe_invoice_id: input.stripeInvoiceId,
      stripe_subscription_id: input.stripeSubscriptionId ?? null,
      stripe_customer_id: input.stripeCustomerId ?? null,
      subscriber_user_id: input.subscriberUserId ?? null,
      subscriber_email: input.subscriberEmail ?? null,
      plan: input.plan ?? null,
      period_start: iso(input.periodStart), period_end: iso(input.periodEnd),
      amount_total_cents: input.totalCents, currency: (input.currency || "EUR").toUpperCase(),
      invoice_status: "processing", live: true,
    }, { onConflict: "stripe_invoice_id", ignoreDuplicates: true })
    .select("id");

  if (!claimed || claimed.length === 0) {
    // Già processata (o in corso): non duplicare email/fattura.
    const { data: prev } = await admin.from("subscription_invoice_log").select("id, document_id, email_sent").eq("stripe_invoice_id", input.stripeInvoiceId).maybeSingle();
    return { ok: true, live, action: "duplicate", documentId: prev?.document_id ?? null, emailSent: !!prev?.email_sent, logId: prev?.id ?? null };
  }
  const logId = claimed[0].id as string;

  // 1) Email di conferma pagamento/ricevuta all'abbonato (gated: siamo già in live).
  let emailSent = false;
  if (input.subscriberEmail && opts.origin) {
    try { await sendSubReceipt(opts.origin, input); emailSent = true; }
    catch (e) { console.warn("[sub-invoicing] invio ricevuta fallito:", (e as Error)?.message); }
  }

  // 2) Bozza fattura elettronica (emittente Xenora, cliente abbonato). Mai trasmessa allo SdI.
  let documentId: string | null = null;
  let reason: string | undefined;
  try {
    const res = await createSubscriberInvoice(admin, input);
    documentId = res.documentId ?? null;
    reason = res.reason;
  } catch (e) { reason = (e as Error)?.message ?? "invoice_error"; }

  const status = documentId ? "draft_created" : "skipped";
  await admin.from("subscription_invoice_log").update({
    document_id: documentId, email_sent: emailSent, invoice_status: status, reason: reason ?? null, updated_at: new Date().toISOString(),
  }).eq("id", logId);

  return { ok: true, live, action: documentId ? "draft_created" : "skipped", reason, documentId, emailSent, logId };
}

export interface CreateSubscriberInvoiceResult { documentId?: string; reason?: string }

// Crea la BOZZA del documento di abbonamento. NON emette e NON trasmette allo SdI.
// Salta (con motivo) se mancano i dati fiscali dell'emittente Xenora o del cliente.
export async function createSubscriberInvoice(
  admin: SupabaseClient, input: SubscriptionPaidInput,
): Promise<CreateSubscriberInvoiceResult> {
  const platformTenant = (process.env.XENORA_PLATFORM_TENANT_ID || "").trim();
  if (!platformTenant) return { reason: "emittente_xenora_non_configurato (XENORA_PLATFORM_TENANT_ID mancante)" };

  const emit = await loadSettings(admin, platformTenant);
  if (!emit || (!emit.vat && !emit.tax_code) || !emit.denominazione) {
    return { reason: "dati_emittente_xenora_incompleti (denominazione/P.IVA in tenant_invoice_settings del tenant piattaforma)" };
  }

  const subUser = (input.subscriberUserId || "").trim();
  if (!subUser) return { reason: "abbonato_sconosciuto (metadata.userId assente sulla subscription Stripe)" };

  const cli = await loadSettings(admin, subUser);
  if (!cli || (!cli.denominazione && !cli.tax_code && !cli.vat)) {
    return { reason: "dati_fiscali_cliente_incompleti (l'abbonato non ha compilato Dati di fatturazione)" };
  }

  const regime = (emit.regime as Regime) || "imprenditoriale_ordinario";
  const provider = emit.default_provider || "openapi";
  const rate = Number(process.env.SUB_INVOICE_VAT_RATE || "22") || 22;

  // Imponibile netto:
  //  - se Stripe fornisce imponibile/IVA (Stripe Tax), uso quelli;
  //  - altrimenti, per il regime ordinario, tratto il totale come IVA-inclusa
  //    (env SUB_INVOICE_VATMODE=exclusive per considerarlo netto e aggiungere l'IVA);
  //  - per forfettario / non imprenditoriale non c'è IVA: netto = totale.
  const vatMode = (process.env.SUB_INVOICE_VATMODE || "inclusive").trim().toLowerCase();
  let netCents: number;
  if (regime !== "imprenditoriale_ordinario") {
    netCents = input.totalCents;
  } else if (typeof input.subtotalCents === "number" && input.subtotalCents > 0 && (input.taxCents ?? 0) > 0) {
    netCents = input.subtotalCents;
  } else if (vatMode === "exclusive") {
    netCents = input.totalCents;
  } else {
    netCents = Math.round(input.totalCents / (1 + rate / 100)); // IVA inclusa
  }

  const planLabel = input.planName || (input.plan ? input.plan.charAt(0).toUpperCase() + input.plan.slice(1) : "");
  const period = input.periodStart && input.periodEnd ? ` — ${dmy(input.periodStart)} → ${dmy(input.periodEnd)}` : "";
  const folio: FolioLine[] = [{
    folioRef: `sub:${input.stripeInvoiceId}`,
    description: `Abbonamento Xenora${planLabel ? ` ${planLabel}` : ""}${period}`.slice(0, 500),
    qty: 1, unitCents: netCents, vatRate: rate, sourceKind: "extra",
  }];

  const draft = buildDocumentDraft({ regime, docKind: "fattura", folio, rounding: !!emit.rounding });

  const counterpart = {
    kind: cli.vat ? "azienda" : "privato",
    name: cli.denominazione || "Cliente",
    vat: cli.vat ?? null, tax_code: cli.tax_code ?? null,
    address: cli.address ?? null, city: cli.city ?? null, cap: cli.cap ?? null,
    province: cli.province ?? null, country: cli.country || "IT",
    sdi_code: cli.sdi || (cli.pec ? "0000000" : "0000000"), pec: cli.pec ?? null,
    email: input.subscriberEmail ?? null,
  };

  const { data: doc, error } = await admin.from("documents").insert({
    tenant_id: platformTenant,
    doc_kind: draft.docKind,
    sdi_type: "TD01",
    regime,
    serie: "ABBONAMENTI",                 // sezionale dedicato agli abbonamenti Xenora
    stato: "bozza",                       // MAI emessa/trasmessa da qui
    counterpart,
    issue_date: null,                     // assegnata all'emissione (manuale)
    vat_exigibility: "I",
    notes: `Abbonamento Xenora${planLabel ? ` ${planLabel}` : ""}${period} · rif. Stripe ${input.stripeInvoiceId}`,
    taxable_cents: draft.totals.taxableCents,
    vat_cents: draft.totals.vatCents,
    out_of_scope_cents: draft.totals.outOfScopeCents,
    bollo_cents: draft.totals.bolloCents,
    rounding_cents: draft.totals.roundingCents,
    total_cents: draft.totals.totalCents,
    advance_cents: 0,
    send_sdi: false,                      // esplicito: non trasmettere allo SdI
    provider,
    currency: (input.currency || "EUR").toUpperCase(),
    snapshot: {
      regime_note: draft.regimeNote,
      subscription: {
        source: "stripe_subscription",
        stripeInvoiceId: input.stripeInvoiceId,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        stripeCustomerId: input.stripeCustomerId ?? null,
        plan: input.plan ?? null, planName: planLabel || null,
        periodStart: iso(input.periodStart), periodEnd: iso(input.periodEnd),
        amountPaidCents: input.totalCents,
      },
      emittente: { denominazione: emit.denominazione, vat: emit.vat, taxCode: emit.tax_code },
    },
  }).select("id").single();
  if (error || !doc) return { reason: error?.message || "insert_failed" };
  const documentId = doc.id as string;

  if (draft.lines.length) {
    const { error: lErr } = await admin.from("document_lines").insert(
      draft.lines.map((l) => ({
        document_id: documentId, tenant_id: platformTenant, pos: l.pos,
        description: l.description, qty: l.qty, unit_price_cents: l.unitPriceCents,
        vat_rate: l.vatRate, vat_nature: l.vatNature, line_total_cents: l.lineTotalCents,
        source_kind: l.sourceKind, folio_ref: l.folioRef,
      })),
    );
    if (lErr) return { reason: lErr.message };
  }

  await admin.from("document_events").insert({
    tenant_id: platformTenant, document_id: documentId, kind: "created",
    message: `Bozza abbonamento Xenora${planLabel ? ` ${planLabel}` : ""} (rif. Stripe ${input.stripeInvoiceId}) — NON trasmessa`,
  });

  return { documentId };
}

// Invia la ricevuta di pagamento dell'abbonamento (kind sub_receipt su /api/email).
async function sendSubReceipt(origin: string, input: SubscriptionPaidInput): Promise<void> {
  const res = await fetch(`${origin}/api/email`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "sub_receipt",
      to: input.subscriberEmail,
      subscription: {
        plan: input.plan ?? null,
        planName: input.planName ?? null,
        totalCents: input.totalCents,
        currency: (input.currency || "EUR").toUpperCase(),
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        invoiceId: input.stripeInvoiceId,
      },
    }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string })?.error || `email ${res.status}`); }
}
