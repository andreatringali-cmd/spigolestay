import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { saveWhatsappCfg, whatsappStatus, whatsappTest, whatsappDiagnose, sendWhatsapp } from "@/lib/whatsapp";
import { logInvio } from "@/lib/invii-log";

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
    if (action === "diagnose") return NextResponse.json(await whatsappDiagnose(auth.admin, auth.tenantId));
    if (action === "test_send") {
      // UN messaggio di prova al numero indicato: prima testo libero, se Meta lo rifiuta il modello dei planning. Restituisce gli errori grezzi di Meta.
      const to = String(b?.to || "").trim();
      if (!to) return NextResponse.json({ ok: false, message: "Numero mancante." });
      const free = await sendWhatsapp(auth.admin, auth.tenantId, { to, text: "Prova Xenora: il collegamento WhatsApp funziona. Puoi ignorare questo messaggio." });
      let tpl: { ok: boolean; message: string; id?: string } | null = null;
      if (!free.ok) tpl = await sendWhatsapp(auth.admin, auth.tenantId, { to, templateName: process.env.WHATSAPP_PULIZIE_TEMPLATE || "planning_pulizie", lang: "it", params: ["Prova Xenora", new Date().toISOString().slice(0, 10), "Messaggio di prova: puoi ignorarlo."] });
      const ok = free.ok || !!tpl?.ok;
      await logInvio(auth.admin, auth.tenantId, { job: "pulizie", ref: "prova", channel: "whatsapp", ok, wamid: (free.ok ? free.id : tpl?.id), detail: free.ok ? `prova: testo libero inviato a ${to}` : `prova · testo libero: ${free.message} · modello: ${tpl?.message ?? ""}` });
      return NextResponse.json({ ok, freeText: free, template: tpl, expectedTemplate: process.env.WHATSAPP_PULIZIE_TEMPLATE || "planning_pulizie" });
    }
    if (action === "test") return NextResponse.json(await whatsappTest(auth.admin, auth.tenantId));
    return NextResponse.json({ ok: true, ...(await whatsappStatus(auth.admin, auth.tenantId)) });
  } catch (e) { return NextResponse.json({ error: "wa_failed", message: (e as Error)?.message ?? "errore" }, { status: 400 }); }
}
