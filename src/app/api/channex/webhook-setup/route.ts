import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, listWebhooks, createWebhook, updateWebhook } from "@/lib/channex";
import { messageHookSecret, bookingHookSecret } from "@/lib/channex-messages";

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

  const result: { propertyId: string; created: boolean; alreadyActive: boolean; headerUpdated?: boolean; error?: string }[] = [];
  const bookingSecret = bookingHookSecret();
  const messageSecret = messageHookSecret();
  for (const pid of props) {
    const existing = await listWebhooks(pid);
    const hooks = existing.data?.data ?? [];
    const find = (url: string) => hooks.find((h) => (h.attributes?.callback_url || "").replace(/\/$/, "") === url.replace(/\/$/, ""));
    // Registra il webhook, oppure (se esiste già) gli applica l'intestazione col segreto condiviso: i webhook
    // registrati prima non l'avevano. L'aggiornamento è idempotente e serve anche a ruotare il segreto.
    const ensure = async (url: string, mask: string, secret: string) => {
      const hook = find(url);
      const headers = secret ? { "X-Xenora-Secret": secret } : undefined;
      if (hook) {
        if (!headers) return { created: false, alreadyActive: true, headerUpdated: false as boolean | undefined, error: undefined as string | undefined };
        // Già col segreto giusto (se Channex ci restituisce le intestazioni): niente chiamata inutile a ogni apertura della pagina.
        const cur = Object.entries(hook.attributes?.headers ?? {}).find(([k]) => k.toLowerCase() === "x-xenora-secret")?.[1];
        if (cur === secret) return { created: false, alreadyActive: true, headerUpdated: false, error: undefined };
        const u = await updateWebhook(hook.id, { headers });
        return { created: false, alreadyActive: true, headerUpdated: u.ok, error: u.ok ? undefined : u.error };
      }
      const c = await createWebhook(pid, url, mask, headers);
      return { created: c.ok, alreadyActive: false, headerUpdated: c.ok && !!headers, error: c.ok ? undefined : c.error };
    };
    // Secondo webhook, solo per i messaggi degli ospiti delle OTA (con segreto nell'intestazione).
    const m = await ensure(messagesUrl, "message", messageSecret);
    if (m.error) console.log("[channex webhook-setup] webhook messaggi", pid, m.error);
    const b = await ensure(callbackUrl, "booking", bookingSecret);
    result.push({ propertyId: pid, created: b.created, alreadyActive: b.alreadyActive, headerUpdated: b.headerUpdated, error: b.error });
  }
  return NextResponse.json({ ok: true, callbackUrl, result });
}
