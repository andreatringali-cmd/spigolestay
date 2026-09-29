import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncSchedine, sendReady } from "@/lib/alloggiati/service";
import { syncIstat, closeDay } from "@/lib/istat/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// CRON: invio automatico degli adempimenti PA (Alloggiati Web + ISTAT/Turist@t).
//
// Il piano Vercel (Hobby) ammette un solo trigger cron per questa fascia oraria,
// quindi qui NON si aggiunge un secondo cron: nella STESSA invocazione giornaliera
// (21:00 UTC = 23:00 IT, vedi vercel.json) si elaborano entrambi i flussi, ognuno
// solo per le strutture che hanno attivato il proprio interruttore opt-in.
//
// 1) ALLOGGIATI WEB — per ogni struttura con alloggiati_settings.auto_daily = true:
//    a) rigenera/aggiorna le schedine dagli arrivi (syncSchedine) — così un check-in
//       fatto in giornata è subito pronto e i no-show vengono ripuliti;
//    b) invia le schedine "pronte" degli ospiti GIÀ arrivati (sendReady esclude gli
//       arrivi futuri): rispetta la finestra di legge (entro 24h dall'arrivo).
//    L'invio REALE avviene solo se ALLOGGIATI_LIVE=1 e le credenziali sono valide;
//    altrimenti sendReady degrada al provider mock (nessun invio reale) — stesso
//    comportamento della UI manuale in /alloggiati-web.
//
// 2) ISTAT / TURIST@T — per ogni struttura con istat_settings.auto_daily = true:
//    a) rigenera i movimenti dagli arrivi (syncIstat);
//    b) chiude/invia la giornata (closeDay) per i movimenti già maturati (arrivo <= oggi).
//    L'invio REALE avviene solo se ISTAT_LIVE=1 e le credenziali sono valide; altrimenti
//    closeDay degrada al comportamento mock — stesso comportamento della UI manuale in /istat.
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

  let structures = 0;   // strutture Alloggiati con auto-invio attivo elaborate
  let generated = 0;    // schedine (ri)generate dagli arrivi
  let sent = 0;         // schedine effettivamente inviate
  const errors: string[] = [];

  let istatStructures = 0;  // strutture ISTAT con auto-invio attivo elaborate
  let istatGenerated = 0;   // movimenti ISTAT (ri)generati dagli arrivi
  let istatSent = 0;        // movimenti ISTAT effettivamente inviati/chiusi
  const istatErrors: string[] = [];

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

  // ── ISTAT / Turist@t — stessa invocazione, nessun cron aggiuntivo (limite piano Hobby) ──
  try {
    const { data: rows, error } = await admin
      .from("istat_settings")
      .select("tenant_id, structure_id")
      .eq("auto_daily", true);
    if (error) { istatErrors.push(`scan: ${error.message}`); }
    else {
      for (const r of (rows ?? []) as { tenant_id: string; structure_id: string }[]) {
        istatStructures++;
        try {
          const g = await syncIstat(admin, r.tenant_id, { structureId: r.structure_id });
          istatGenerated += g.count ?? 0;
        } catch (e) { istatErrors.push(`sync ${r.structure_id}: ${e instanceof Error ? e.message : "error"}`); }
        try {
          const s = await closeDay(admin, r.tenant_id, r.structure_id);
          istatSent += s.sent ?? 0;
          if (!s.ok && s.sent === 0 && s.message && !/Nessuna riga da inviare/i.test(s.message)) {
            istatErrors.push(`close ${r.structure_id}: ${s.message}`);
          }
        } catch (e) { istatErrors.push(`close ${r.structure_id}: ${e instanceof Error ? e.message : "error"}`); }
      }
    }
  } catch (e) { istatErrors.push(e instanceof Error ? e.message : "istat_scan_failed"); }

  return NextResponse.json({
    ok: true,
    structures, generated, sent, ...(errors.length ? { errors: errors.slice(0, 50) } : {}),
    istat: { structures: istatStructures, generated: istatGenerated, sent: istatSent, ...(istatErrors.length ? { errors: istatErrors.slice(0, 50) } : {}) },
  });
}
