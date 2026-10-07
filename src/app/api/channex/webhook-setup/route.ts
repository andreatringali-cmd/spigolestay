import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, listWebhooks, createWebhook } from "@/lib/channex";
import { messageHookSecret } from "@/lib/channex-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Registra (in modo idempotente) il webhook Channex per le property del tenant, così le
// prenotazioni OTA arrivano in TEMPO REALE senza premere nulla. Callback fisso su xenora.it
// (dev'essere un URL pubblico raggiungibile da Channex, anche da staging).
// POST /api/channex/webhook-setup (bearer)
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://xenora.it"}/api/channex/webhook`;
  const messagesUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://xenora.it"}/api/channex/webhook-messages`;
  const { data: maps } = await auth.admin.from("channex_map").select("channex_property_id").eq("tenant_id", auth.tenantId);
  const props = Array.from(new Set((maps ?? []).map((m) => m.channex_property_id as string).filter(Boolean)));
  if (!props.length) return NextResponse.json({ ok: false, error: "Nessuna struttura collegata a Channex." }, { status: 200 });

  const result: { propertyId: string; created: boolean; alreadyActive: boolean; error?: string }[] = [];
  for (const pid of props) {
    const existing = await listWebhooks(pid);
    const hooks = existing.data?.data ?? [];
    const has = (url: string) => hooks.some((h) => (h.attributes?.callback_url || "").replace(/\/$/, "") === url.replace(/\/$/, ""));
    // Secondo webhook, solo per i messaggi degli ospiti delle OTA (con segreto nell'intestazione): non toccare quello delle prenotazioni.
    if (!has(messagesUrl)) {
      const secret = messageHookSecret();
      await createWebhook(pid, messagesUrl, "message", secret ? { "X-Xenora-Secret": secret } : undefined);
    }
    if (has(callbackUrl)) { result.push({ propertyId: pid, created: false, alreadyActive: true }); continue; }
    const c = await createWebhook(pid, callbackUrl);
    result.push({ propertyId: pid, created: c.ok, alreadyActive: false, error: c.ok ? undefined : c.error });
  }
  return NextResponse.json({ ok: true, callbackUrl, result });
}
