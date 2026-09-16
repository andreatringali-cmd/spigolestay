import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { sendDocument } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Invia il documento emesso all'intermediario (SDI).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const documentId = String(body?.documentId || "").trim();
    if (!documentId) return NextResponse.json({ error: "missing_document" }, { status: 400 });
    const res = await sendDocument(auth.admin, auth.tenantId, documentId);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: "send_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
