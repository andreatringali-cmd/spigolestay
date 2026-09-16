import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { createBlankDocument } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crea una bozza vuota (senza prenotazione).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const res = await createBlankDocument(auth.admin, auth.tenantId, { structureId: body?.structureId || undefined });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: "create_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
