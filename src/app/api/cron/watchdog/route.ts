import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { runWatchdog, resendSender } from "@/lib/watchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// WATCHDOG (controllo salute): database raggiungibile e veloce, ultimo controllo notturno ok, copie giornaliere, errori di sincronizzazione.
// Manda UNA email al titolare solo se qualcosa non va (max una ogni 6 ore per tipo di problema) e SOLO se WATCHDOG_ENABLED=1;
// altrimenti restituisce soltanto il report JSON. Sola lettura sui dati dell'app; l'unica scrittura è watchdog_state (quando sono partiti gli avvisi).
//
// NON è in vercel.json (il piano Hobby limita la frequenza dei cron): va chiamato da fuori (pg_cron o un servizio gratuito), vedi docs/PRESTAZIONI.md.
// Autenticazione come gli altri cron: `Authorization: Bearer <CRON_SECRET>`; per la prova a mano anche `?secret=`.
// `?strict=1`: risponde 503 se c'è un problema urgente (utile ai servizi esterni che avvisano sugli errori HTTP).
// ─────────────────────────────────────────────────────────────────────────────
function same(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, skipped: "no_secret" });
  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const q = url.searchParams.get("secret") || "";
  if (!(bearer && same(bearer, secret)) && !(q && same(q, secret))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !service) return NextResponse.json({ ok: false, skipped: "supabase_not_configured" });
  const db = createClient(supaUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const report = await runWatchdog({
      db,
      env: { WATCHDOG_ENABLED: process.env.WATCHDOG_ENABLED, WATCHDOG_TO: process.env.WATCHDOG_TO, ADMIN_EMAILS: process.env.ADMIN_EMAILS },
      send: resendSender({ RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_FROM: process.env.RESEND_FROM }),
    });
    if (!report.ok) console.error("[watchdog]", JSON.stringify(report.problems.map((p) => p.key)));
    const crit = report.problems.some((p) => p.severity === "crit");
    return NextResponse.json(report, { status: url.searchParams.get("strict") === "1" && crit ? 503 : 200 });
  } catch (e) {
    console.error("[watchdog] errore inatteso:", (e as Error)?.message);
    return NextResponse.json({ ok: false, error: "watchdog_failed" }, { status: 500 });
  }
}
