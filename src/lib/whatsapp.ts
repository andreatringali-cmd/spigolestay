// WhatsApp Cloud API (Meta) — invio reale dei messaggi agli ospiti.
// Credenziali per-tenant cifrate in provider_credentials (provider = "whatsapp"):
//   config = { token_enc, phone_id }. Token mai esposto al client.
// Entro le 24h dall'ultimo messaggio dell'ospite si può inviare testo libero;
// per i messaggi "a freddo" serve un template approvato (name + lang).
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptCred, decryptCred } from "@/lib/crypto-creds";

const GRAPH = "https://graph.facebook.com/v21.0";
const digits = (s: string) => (s || "").replace(/\D/g, "");

interface WaCfg { token: string; phoneId: string }
async function readCfg(admin: SupabaseClient, tenantId: string): Promise<WaCfg | null> {
  const { data } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", "whatsapp").maybeSingle();
  const c = (data?.config as Record<string, unknown>) ?? {};
  const token = decryptCred(c.token_enc as string);
  const phoneId = (c.phone_id as string) || "";
  if (!token || !phoneId) return null;
  return { token, phoneId };
}

export async function saveWhatsappCfg(admin: SupabaseClient, tenantId: string, opts: { token?: string; phoneId?: string }): Promise<{ ok: boolean; message: string }> {
  const { data: existing } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", "whatsapp").maybeSingle();
  const prev = (existing?.config as Record<string, unknown>) ?? {};
  const config: Record<string, unknown> = { ...prev };
  if (opts.phoneId != null) config.phone_id = opts.phoneId.trim();
  if (opts.token) config.token_enc = encryptCred(opts.token.trim());
  const { error } = await admin.from("provider_credentials").upsert({ tenant_id: tenantId, provider: "whatsapp", config, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,provider" });
  return { ok: !error, message: error ? error.message : "WhatsApp collegato ✓" };
}

export async function whatsappStatus(admin: SupabaseClient, tenantId: string): Promise<{ connected: boolean; phoneId: string }> {
  const { data } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", "whatsapp").maybeSingle();
  const c = (data?.config as Record<string, unknown>) ?? {};
  return { connected: !!c.token_enc && !!c.phone_id, phoneId: (c.phone_id as string) || "" };
}

// Verifica il collegamento leggendo il numero via Graph.
export async function whatsappTest(admin: SupabaseClient, tenantId: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await readCfg(admin, tenantId);
  if (!cfg) return { ok: false, message: "Credenziali WhatsApp mancanti." };
  try {
    const r = await fetch(`${GRAPH}/${cfg.phoneId}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, message: j?.error?.message || `Errore ${r.status}` };
    return { ok: true, message: `Collegato: ${j.verified_name || ""} ${j.display_phone_number || ""}`.trim() };
  } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Errore di connessione." }; }
}

export interface SendArgs { to: string; text?: string; templateName?: string; lang?: string }
export async function sendWhatsapp(admin: SupabaseClient, tenantId: string, args: SendArgs): Promise<{ ok: boolean; message: string; id?: string }> {
  const cfg = await readCfg(admin, tenantId);
  if (!cfg) return { ok: false, message: "WhatsApp non collegato." };
  const to = digits(args.to);
  if (!to) return { ok: false, message: "Numero destinatario mancante." };

  const body: Record<string, unknown> = { messaging_product: "whatsapp", to };
  if (args.templateName) {
    body.type = "template";
    body.template = { name: args.templateName, language: { code: args.lang || "it" } };
  } else {
    body.type = "text";
    body.text = { body: args.text || "" };
  }
  try {
    const r = await fetch(`${GRAPH}/${cfg.phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, message: j?.error?.message || `Errore ${r.status}` };
    return { ok: true, message: "Inviato", id: j?.messages?.[0]?.id };
  } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Invio non riuscito." }; }
}
