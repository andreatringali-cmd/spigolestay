import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { listIstatSubmissions } from "@/lib/istat/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Archivio invii ISTAT (storico chiusure giornaliere).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const structureId = String(body?.structureId || "").trim();
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });
    const res = await listIstatSubmissions(auth.admin, auth.tenantId, structureId);
    return NextResponse.json({ ok: res.ok, items: res.items });
  } catch (e) { return NextResponse.json({ error: "submissions_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
