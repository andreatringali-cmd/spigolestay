import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ultimi invii automatici dell'account (esito ed eventuale errore). GET /api/invii-log?job=pulizie
export async function GET(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const job = new URL(req.url).searchParams.get("job") || "";
  let q = auth.admin.from("invii_log").select("at, job, ref, channel, ok, detail").eq("tenant_id", auth.tenantId).order("at", { ascending: false }).limit(20);
  if (job === "pulizie" || job === "messaggi") q = q.eq("job", job);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "log_failed", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}
