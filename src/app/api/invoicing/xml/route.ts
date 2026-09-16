import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { getDocumentXml } from "@/lib/invoicing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Restituisce l'XML del documento prodotto dall'intermediario (per download).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const documentId = String(body?.documentId || "").trim();
    if (!documentId) return NextResponse.json({ error: "missing_document" }, { status: 400 });
    const xml = await getDocumentXml(auth.admin, auth.tenantId, documentId);
    if (xml == null) return NextResponse.json({ error: "xml_not_available" }, { status: 404 });
    return NextResponse.json({ ok: true, xml });
  } catch (e) {
    return NextResponse.json({ error: "xml_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 });
  }
}
