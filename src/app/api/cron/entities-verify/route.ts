import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (bearer !== secret && (url.searchParams.get("secret") || "") !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !service) return NextResponse.json({ ok: false, skipped: "supabase_not_configured" });
  const admin = createClient(supaUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await admin.rpc("entities_verify_run");
  if (error) { console.error("[entities-verify]", error.message); return NextResponse.json({ ok: false, error: error.message }, { status: 500 }); }
  const r = data as { ok?: boolean; bad?: number } | null;
  if (!r?.ok) console.error("[entities-verify] DIFFERENZE tra blob e tabella:", JSON.stringify(r).slice(0, 2000));
  return NextResponse.json({ ok: !!r?.ok, bad: r?.bad ?? null });
}
