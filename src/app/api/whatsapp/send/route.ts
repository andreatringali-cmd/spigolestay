import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { sendWhatsapp } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Invio reale di un messaggio WhatsApp all'ospite (Cloud API).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const to = String(b?.to || "").trim();
    if (!to) return NextResponse.json({ error: "missing_to" }, { status: 400 });
    const res = await sendWhatsapp(auth.admin, auth.tenantId, { to, text: b?.text, templateName: b?.templateName, lang: b?.lang });
    return NextResponse.json(res);
  } catch (e) { return NextResponse.json({ error: "send_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
