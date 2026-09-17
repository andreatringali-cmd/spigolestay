import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { fetchRicevuta } from "@/lib/alloggiati/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scarica la ricevuta PDF (base64) degli invii di una data (ultimi 30gg, escluso oggi).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const structureId = String(body?.structureId || "").trim();
    const date = String(body?.date || "").trim();
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });
    if (!date) return NextResponse.json({ error: "missing_date" }, { status: 400 });
    const res = await fetchRicevuta(auth.admin, auth.tenantId, structureId, date);
    return NextResponse.json({ ok: res.ok, message: res.message, pdfBase64: res.pdfBase64 });
  } catch (e) { return NextResponse.json({ error: "ricevuta_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
