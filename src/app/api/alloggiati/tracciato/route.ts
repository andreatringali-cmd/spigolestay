import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { buildTracciato } from "@/lib/alloggiati/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Genera il tracciato .txt delle schedine pronte (fallback per l'invio manuale al Portale Alloggiati).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const structureId = String(body?.structureId || "").trim();
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });
    const res = await buildTracciato(auth.admin, auth.tenantId, structureId);
    return NextResponse.json({ ok: res.ok, message: res.message, text: res.text, count: res.count });
  } catch (e) { return NextResponse.json({ error: "tracciato_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
