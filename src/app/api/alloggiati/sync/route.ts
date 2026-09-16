import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { syncSchedine } from "@/lib/alloggiati/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const res = await syncSchedine(auth.admin, auth.tenantId, { structureId: body?.structureId || undefined });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) { return NextResponse.json({ error: "sync_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
