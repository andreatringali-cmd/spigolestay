import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncSchedine, sendReady } from "@/lib/alloggiati/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// CRON: invio automatico delle schedine alla Questura (Alloggiati Web).
//
// Per ogni struttura con "Invio automatico" attivo (alloggiati_settings.auto_daily = true):
//   1) rigenera/aggiorna le schedine dagli arrivi (syncSchedine) — così un check-in
//      fatto in giornata è subito pronto e i no-show vengono ripuliti;
//   2) invia le schedine "pronte" degli ospiti GIÀ arrivati (sendReady esclude gli
//      arrivi futuri): rispetta la finestra di legge (entro 24h dall'arrivo).
//
// L'invio REALE avviene solo se ALLOGGIATI_LIVE=1 e le credenziali sono valide;
// altrimenti sendReady degrada al provider mock (nessun invio reale).
//
// Auth: header Bearer <CRON_SECRET> (inviato da Vercel Cron) oppure ?secret= per test.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, skipped: "no_secret" });
  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const querySecret = url.searchParams.get("secret") || "";
  if (bearer !== secret && querySecret !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !service) return NextResponse.json({ ok: false, skipped: "supabase_not_configured" });
  const admin = createClient(supaUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let structures = 0;   // strutture con auto-invio attivo elaborate
  let generated = 0;    // schedine (ri)generate dagli arrivi
  let sent = 0;         // schedine effettivamente inviate
  const errors: string[] = [];

  try {
    const { data: rows, error } = await admin
      .from("alloggiati_settings")
      .select("tenant_id, structure_id")
      .eq("auto_daily", true);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    for (const r of (rows ?? []) as { tenant_id: string; structure_id: string }[]) {
      structures++;
      try {
        const g = await syncSchedine(admin, r.tenant_id, { structureId: r.structure_id });
        generated += g.count ?? 0;
      } catch (e) { errors.push(`sync ${r.structure_id}: ${e instanceof Error ? e.message : "error"}`); }
      try {
        const s = await sendReady(admin, r.tenant_id, r.structure_id);
        sent += s.sent ?? 0;
        if (!s.ok && s.sent === 0 && s.message && !/Nessuna schedina/i.test(s.message)) {
          errors.push(`send ${r.structure_id}: ${s.message}`);
        }
      } catch (e) { errors.push(`send ${r.structure_id}: ${e instanceof Error ? e.message : "error"}`); }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "scan_failed", structures, sent }, { status: 500 });
  }

  return NextResponse.json({ ok: true, structures, generated, sent, ...(errors.length ? { errors: errors.slice(0, 50) } : {}) });
}
