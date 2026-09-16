import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { createCreditNote } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crea una nota di credito (bozza) che storna un documento emesso.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const documentId = String(body?.documentId || "").trim();
    if (!documentId) return NextResponse.json({ error: "missing_document" }, { status: 400 });
    const res = await createCreditNote(auth.admin, auth.tenantId, documentId);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: "credit_note_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
