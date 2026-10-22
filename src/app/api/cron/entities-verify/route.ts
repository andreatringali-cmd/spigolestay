import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { flushCompareStats, recordCompare } from "@/lib/compare-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// CRON (ogni notte): controllo della Fase 1 dell'architettura dati.
// Confronta i blob (app_state / org_state) con la tabella `entities` (una riga per prenotazione/ospite/camera…): per ogni proprietario e tipo conta le entità
// mancanti, in più e diverse. Il risultato resta in `entities_verify_log`. Si passa alla Fase 2 (lettura a finestra) solo dopo notti consecutive con `ok: true`.
// Autenticazione come gli altri cron: `Authorization: Bearer <CRON_SECRET>` oppure `?secret=` per la prova manuale. Sola lettura sui dati dell'app.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, skipped: "no_secret" });
  if (!cronAuthorized(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !service) return NextResponse.json({ ok: false, skipped: "supabase_not_configured" });
  const admin = createClient(supaUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await admin.rpc("entities_verify_run");
  if (error) { console.error("[entities-verify]", error.message); return NextResponse.json({ ok: false, error: error.message }, { status: 500 }); }
  const r = data as { ok?: boolean; bad?: number } | null;
  if (!r?.ok) console.error("[entities-verify] DIFFERENZE tra blob e tabella:", JSON.stringify(r).slice(0, 2000));

  // Anche i tipi aggiunti dopo (prezzi, attività, cancellazioni…): prima il controllo notturno non li guardava. L'esito va nei contatori (riga «verify:extra»).
  let extraBad: number | null = null;
  try {
    const ex = await admin.rpc("entities_verify_extra");
    if (!ex.error && Array.isArray(ex.data)) {
      const bad = (ex.data as { kind?: string; missing?: number; extra?: number; different?: number }[]).filter((x) => (x.missing ?? 0) > 0 || (x.extra ?? 0) > 0 || (x.different ?? 0) > 0 || x.kind === "parse_error");
      extraBad = bad.length;
      if (bad.length) console.error("[entities-verify] DIFFERENZE nei tipi aggiuntivi:", JSON.stringify(bad).slice(0, 2000));
      recordCompare("verify:extra", bad.length ? "diff" : "ok", bad.slice(0, 5));
    } else if (ex.error) { recordCompare("verify:extra", "error", { message: ex.error.message.slice(0, 200) }); }
  } catch (e) { recordCompare("verify:extra", "error", { message: e instanceof Error ? e.message.slice(0, 200) : "errore" }); }
  recordCompare("verify:main", r?.ok ? "ok" : "diff", r);
  await flushCompareStats();
  return NextResponse.json({ ok: !!r?.ok && (extraBad ?? 0) === 0, bad: r?.bad ?? null, extraBad });
}
