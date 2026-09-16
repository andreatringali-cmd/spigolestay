import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { issueDocument } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Emette il documento (numerazione atomica + congelamento).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const documentId = String(body?.documentId || "").trim();
    if (!documentId) return NextResponse.json({ error: "missing_document" }, { status: 400 });
    const res = await issueDocument(auth.admin, auth.tenantId, documentId);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: "issue_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
