import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { saveWhatsappCfg, whatsappStatus, whatsappTest } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Collegamento WhatsApp Cloud API: action "save" | "status" | "test".
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b?.action || "status").trim();
    if (action === "save") return NextResponse.json(await saveWhatsappCfg(auth.admin, auth.tenantId, { token: b?.token || undefined, phoneId: b?.phoneId ?? undefined }));
    if (action === "test") return NextResponse.json(await whatsappTest(auth.admin, auth.tenantId));
    return NextResponse.json({ ok: true, ...(await whatsappStatus(auth.admin, auth.tenantId)) });
  } catch (e) { return NextResponse.json({ error: "wa_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
