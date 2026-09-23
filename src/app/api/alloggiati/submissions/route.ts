import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { listSubmissions, getSubmissionRicevuta } from "@/lib/alloggiati/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Archivio invii Alloggiati: elenco (action "list") e ricevuta di un invio (action "ricevuta").
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const structureId = String(body?.structureId || "").trim();
    const action = String(body?.action || "list").trim();
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });
    if (action === "ricevuta") {
      const submissionId = String(body?.submissionId || "").trim();
      if (!submissionId) return NextResponse.json({ error: "missing_submission" }, { status: 400 });
      const res = await getSubmissionRicevuta(auth.admin, auth.tenantId, structureId, submissionId);
      return NextResponse.json({ ok: res.ok, message: res.message, pdfBase64: res.pdfBase64 });
    }
    const res = await listSubmissions(auth.admin, auth.tenantId, structureId);
    return NextResponse.json({ ok: res.ok, items: res.items });
  } catch (e) { return NextResponse.json({ error: "submissions_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
