import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { testReady } from "@/lib/alloggiati/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Controllo preliminare (Test) delle schedine pronte, senza inviarle.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const structureId = String(body?.structureId || "").trim();
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });
    const res = await testReady(auth.admin, auth.tenantId, structureId, body?.arrival || undefined);
    return NextResponse.json({ ok: res.ok, message: res.message });
  } catch (e) { return NextResponse.json({ error: "check_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
