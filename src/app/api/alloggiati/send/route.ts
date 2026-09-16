import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { sendReady } from "@/lib/alloggiati/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const structureId = String(body?.structureId || "").trim();
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });
    const res = await sendReady(auth.admin, auth.tenantId, structureId, body?.arrival || undefined);
    return NextResponse.json({ ok: res.ok, message: res.message, sent: res.sent });
  } catch (e) { return NextResponse.json({ error: "send_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
