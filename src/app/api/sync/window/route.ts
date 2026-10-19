import { NextResponse } from "next/server";
import { syncAuth, idColOf, isSyncTable } from "@/lib/sync-server";
import { windowRowData, WINDOW_PAST_DAYS } from "@/lib/sync-window";
import { todayRome } from "@/lib/dates-rome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/sync/window?table=app_state|org_state&id=<uid|orgId>[&past=400|all]  (Bearer = token dell'utente)
// Come leggere la riga di stato, ma con le prenotazioni/ospiti RISTRETTI a una finestra (vedi lib/sync-window.ts): il browser scarica una frazione dei dati.
// La lettura passa dalle regole di sicurezza del database come se la facesse il browser (client con il token dell'utente). Sola lettura.
export async function GET(req: Request) {
  const auth = await syncAuth(req);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const u = new URL(req.url);
  const table = u.searchParams.get("table");
  const id = (u.searchParams.get("id") || "").trim();
  if (!isSyncTable(table) || !id) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const pastParam = u.searchParams.get("past") || "";
  const past = pastParam === "all" ? null : Math.min(4000, Math.max(30, Number(pastParam) || WINDOW_PAST_DAYS));

  const { data, error } = await auth.userClient.from(table).select("data, rev").eq(idColOf(table), id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "read_failed" }, { status: 500 });
  const row = data as { data?: Record<string, string> | null; rev?: number | null } | null;
  if (!row) return NextResponse.json({ ok: true, data: null, rev: null, windowed: false });
  const rev = typeof row.rev === "number" ? row.rev : null;
  if (past === null) return NextResponse.json({ ok: true, data: row.data ?? null, rev, windowed: false });
  const w = windowRowData(row.data ?? null, todayRome(), past);
  return NextResponse.json({ ok: true, data: w.data, rev, windowed: !!w.stats, stats: w.stats, pastDays: past });
}
