import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { internalFetch } from "@/lib/server-auth";
import { pollTenantSdiStatus, type NotifyResult, type RejectionNotice } from "@/lib/invoicing/service";
import { rejectionEmail, addTally, emptyTally, type PollTally } from "@/lib/invoicing/sdi-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────────────────────
// CRON: aggiorna gli esiti SdI delle fatture inviate tramite Fatture in Cloud e avvisa il titolare degli scarti.
//
// Vercel Cron chiama questo endpoint una volta al giorno (vedi vercel.json). Autenticazione identica agli altri cron:
// header `Authorization: Bearer <CRON_SECRET>` (inviato da Vercel) oppure `?secret=` per la prova manuale.
// SOLA LETTURA verso Fatture in Cloud. Per ogni tenant con FIC collegato: massimo 50 documenti "in attesa",
// non in prova, inviati da meno di 60 giorni. Un errore su un documento/tenant non ferma gli altri.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TENANTS = 500;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, skipped: "no_secret" });
  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const querySecret = url.searchParams.get("secret") || "";
  if (bearer !== secret && querySecret !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !service) return NextResponse.json({ ok: false, skipped: "supabase_not_configured" });
  const admin = createClient(supaUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // Indirizzo FISSO del sito (come gli altri cron).
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || "https://xenora.it").replace(/\/+$/, "");

  // Tenant con Fatture in Cloud collegato (token di rinnovo presente).
  const { data: creds, error: credErr } = await admin.from("provider_credentials").select("tenant_id, config").eq("provider", "fattureincloud").limit(MAX_TENANTS);
  if (credErr) return NextResponse.json({ ok: false, error: credErr.message }, { status: 500 });
  const tenants = (creds ?? []).filter((c) => typeof (c.config as Record<string, unknown> | null)?.refresh_token_enc === "string").map((c) => String(c.tenant_id));

  let total: PollTally = emptyTally();
  let skippedTrial = 0, skippedOld = 0, skippedOverLimit = 0, noRecipient = 0;
  const errors: string[] = [];

  for (const tenantId of tenants) {
    try {
      const to = await ownerEmail(admin, tenantId);
      const notify = async (n: RejectionNotice): Promise<NotifyResult> => {
        if (!to) { noRecipient++; return "no_recipient"; }
        const mail = rejectionEmail({ numberLabel: n.numberLabel, issueDate: n.issueDate, customer: n.customer, reason: n.reason });
        const r = await internalFetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "notify", event: "alert", to, subject: mail.subject, text: mail.text, ctaUrl: `${origin}/documenti/${n.documentId}`, ctaLabel: "Apri il documento" }),
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; skipped?: string };
        // "skipped" (es. freno antiraffica) = non inviata: il marcatore non si scrive e si riprova al prossimo passaggio.
        return r.ok && j.ok && !j.skipped ? "sent" : "failed";
      };
      const r = await pollTenantSdiStatus(admin, tenantId, { notify });
      total = addTally(total, r);
      skippedTrial += r.skippedTrial; skippedOld += r.skippedOld; skippedOverLimit += r.skippedOverLimit;
      for (const m of r.errorMessages) errors.push(`${tenantId.slice(0, 8)} ${m}`);
    } catch (e) {
      total = { ...total, errors: total.errors + 1 };
      errors.push(`${tenantId.slice(0, 8)}: ${e instanceof Error ? e.message : "errore"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: tenants.length,
    checked: total.checked,
    changed: total.changed,
    rejected: total.rejected,
    delivered: total.delivered,
    notified: total.notified,
    errors: total.errors,
    skippedTrial, skippedOld, skippedOverLimit, noRecipient,
    ...(errors.length ? { errorDetails: errors.slice(0, 50) } : {}),
  });
}

// Email del titolare = indirizzo dell'account (tenant_id è l'id utente), come per gli altri avvisi (es. messaggi OTA).
async function ownerEmail(admin: SupabaseClient, tenantId: string): Promise<string> {
  try {
    const { data } = await admin.auth.admin.getUserById(tenantId);
    return (data?.user?.email || "").trim();
  } catch { return ""; }
}
