import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { channexEnabled } from "@/lib/channex";
import { runCertScenario, SCENARIO_IDS, type ScenarioId } from "@/lib/channex-cert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Esegue UNO scenario di certificazione Channex (1..10) e restituisce i task_id + esito.
// SOLO-ADMIN: accesso riservato alle email in ADMIN_EMAILS (stesso pattern del back-office).
// POST /api/channex/cert/run  body: { scenario: "1".."10" }
// → { ok, scenario, label, calls: [{ endpoint, taskId, status, ok, sent, error?, raw? }], error? }

const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (error || !caller?.email || !OWNER_EMAILS.includes(caller.email.toLowerCase())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const body = await req.json().catch(() => null) as { scenario?: string } | null;
  const scenario = String(body?.scenario || "") as ScenarioId;
  if (!SCENARIO_IDS.includes(scenario)) return NextResponse.json({ ok: false, error: "scenario non valido" }, { status: 400 });

  const res = await runCertScenario(admin, caller.id, scenario);
  return NextResponse.json(res, { status: 200 });
}
