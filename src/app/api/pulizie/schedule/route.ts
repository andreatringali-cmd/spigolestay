import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/pulizie/schedule (bearer) { structureId, enabled, time, email, emailTo }
// Registra l'orario dell'invio automatico del Planning pulizie nella tabella piccola `pulizie_schedule`, letta dal cron ogni 10 minuti
// (così non deve rileggere i dati pesanti). Si chiama a ogni «Salva» di Invio automatico.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const body = await req.json().catch(() => ({}));
  const structureId = typeof body?.structureId === "string" ? body.structureId.trim() : "";
  if (!structureId) return NextResponse.json({ ok: false, error: "Struttura mancante." }, { status: 400 });
  const time = typeof body?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : "08:00";
  const emailTo = typeof body?.emailTo === "string" ? body.emailTo.trim().slice(0, 200) : "";
  const { error } = await auth.admin.from("pulizie_schedule").upsert({
    tenant_id: auth.tenantId, structure_id: structureId, enabled: body?.enabled === true, send_time: time, email: body?.email !== false, email_to: emailTo, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,structure_id" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
