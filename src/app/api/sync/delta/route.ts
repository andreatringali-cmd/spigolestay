import { NextResponse } from "next/server";
import { syncAuth, idColOf, isSyncTable } from "@/lib/sync-server";
import { applyDelta, isEmptyDelta, describeDelta, describeFieldChanges, DeltaError, type Delta } from "@/lib/sync-delta";
import { deltaAllowedFor } from "@/lib/delta-allow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/sync/delta (Bearer = token dell'utente)  { table, id, expectedRev, delta }
// Applica al blocco COMPLETO sul server solo le modifiche inviate dal browser (entità nuove/cambiate, cancellazioni esplicite, lapidi, campi, chiavi piatte),
// con il lucchetto di versione: se nel frattempo la riga è cambiata risponde 409 e il browser rilegge e riprova al ciclo dopo (come con la scrittura intera).
// La scrittura passa dalle regole di sicurezza del database come se la facesse il browser. Cancellazioni di massa rifiutate senza conferma (vedi lib/sync-delta.ts).
export async function POST(req: Request) {
  const auth = await syncAuth(req);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!deltaAllowedFor(auth.userId)) return NextResponse.json({ ok: false, error: "not_enabled" }, { status: 403 }); // prova riservata agli account abilitati
  const body = await req.json().catch(() => null) as { table?: unknown; id?: unknown; expectedRev?: unknown; delta?: Delta } | null;
  if (!body || !isSyncTable(body.table) || typeof body.id !== "string" || !body.id || !body.delta || typeof body.delta !== "object") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const table = body.table, id = body.id;
  const expectedRev = typeof body.expectedRev === "number" ? body.expectedRev : null;
  if (expectedRev === null) return NextResponse.json({ ok: false, error: "rev_required" }, { status: 400 });
  const delta = body.delta;
  if (isEmptyDelta(delta)) return NextResponse.json({ ok: true, rev: expectedRev, noop: true });

  const idCol = idColOf(table);
  const { data, error } = await auth.userClient.from(table).select("data, rev").eq(idCol, id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "read_failed" }, { status: 500 });
  const row = data as { data?: Record<string, string> | null; rev?: number | null } | null;
  if (!row) return NextResponse.json({ ok: false, error: "no_row" }, { status: 404 });
  if (row.rev !== expectedRev) return NextResponse.json({ ok: false, conflict: true, rev: row.rev ?? null }, { status: 409 });

  console.log("[sync/delta]", table, id.slice(0, 8), "rev", expectedRev, describeDelta(delta), describeFieldChanges(row.data ?? null, delta)); // diagnostica: cosa viene rimandato a ogni ciclo (solo conteggi e nomi di chiavi)
  let next: Record<string, string>;
  try {
    const applied = applyDelta(row.data ?? null, delta);
    if (!applied.stats.changed) return NextResponse.json({ ok: true, rev: expectedRev, noop: true }); // già tutto uguale sul server: nessuna scrittura, la versione non cambia
    next = applied.row;
  }
  catch (e) {
    if (e instanceof DeltaError) return NextResponse.json({ ok: false, error: e.code, message: e.message }, { status: e.code === "mass_delete" ? 422 : 500 });
    return NextResponse.json({ ok: false, error: "apply_failed" }, { status: 500 });
  }

  const { data: upd, error: wErr } = await auth.userClient.from(table).update({ data: next, updated_at: new Date().toISOString() }).eq(idCol, id).eq("rev", expectedRev).select("rev");
  if (wErr) return NextResponse.json({ ok: false, error: "write_failed" }, { status: 500 });
  const rows = (upd as { rev?: number }[] | null) ?? [];
  if (rows.length === 0) return NextResponse.json({ ok: false, conflict: true }, { status: 409 });
  const nr = rows[0]?.rev;
  return NextResponse.json({ ok: true, rev: typeof nr === "number" ? nr : expectedRev + 1 });
}
