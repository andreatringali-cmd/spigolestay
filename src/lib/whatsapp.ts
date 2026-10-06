// WhatsApp Cloud API (Meta) — invio reale dei messaggi agli ospiti.
// Credenziali per-tenant cifrate in provider_credentials (provider = "whatsapp"):
//   config = { token_enc, phone_id }. Token mai esposto al client.
// Entro le 24h dall'ultimo messaggio dell'ospite si può inviare testo libero;
// per i messaggi "a freddo" serve un template approvato (name + lang).
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptCred, decryptCred } from "@/lib/crypto-creds";
import { waDigits } from "@/lib/contacts-check";

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

export interface SendArgs { to: string; country?: string; text?: string; templateName?: string; lang?: string; params?: string[] }
export async function sendWhatsapp(admin: SupabaseClient, tenantId: string, args: SendArgs): Promise<{ ok: boolean; message: string; id?: string }> {
  const cfg = await readCfg(admin, tenantId);
  if (!cfg) return { ok: false, message: "WhatsApp non collegato." };
  const to = waDigits(args.to, args.country) || digits(args.to); // "3473824353" senza prefisso → 393473824353
  if (!to) return { ok: false, message: "Numero destinatario mancante." };

  const body: Record<string, unknown> = { messaging_product: "whatsapp", to };
  if (args.templateName) {
    body.type = "template";
    body.template = {
      name: args.templateName, language: { code: args.lang || "it" },
      // Variabili del corpo del modello ({{1}}, {{2}}…): niente a capo né tab (regola di Meta).
      ...(args.params?.length ? { components: [{ type: "body", parameters: args.params.map((t) => ({ type: "text", text: t.replace(/[\r\n\t]+/g, " · ").replace(/ {2,}/g, " ").trim().slice(0, 900) || "-" })) }] } : {}),
    };
  } else {
    body.type = "text";
    // preview_url: senza, la Cloud API NON genera l'anteprima (foto + descrizione) dei link nel testo.
    body.text = { body: args.text || "", preview_url: true };
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

// Token del tenant per scaricare i file dei messaggi in arrivo (vocali): resta sul server.
export async function getWhatsappToken(admin: SupabaseClient, tenantId: string): Promise<string | null> {
  return (await readCfg(admin, tenantId))?.token ?? null;
}

/** Diagnosi del collegamento WhatsApp: stato del numero, modello usato per i messaggi "a freddo" e perché un invio potrebbe essere rifiutato. Non invia nulla. */
export async function whatsappDiagnose(admin: SupabaseClient, tenantId: string): Promise<Record<string, unknown>> {
  const cfg = await readCfg(admin, tenantId);
  if (!cfg) return { ok: false, message: "WhatsApp non collegato." };
  const out: Record<string, unknown> = { ok: true };
  const get = async (path: string) => {
    try {
      const r = await fetch(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${cfg.token}` } });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, data: j } : { ok: false, error: j?.error?.message || `Errore ${r.status}`, code: j?.error?.code };
    } catch (e) { return { ok: false, error: (e as Error)?.message ?? "rete" }; }
  };
  out.phone = await get(`${cfg.phoneId}?fields=display_phone_number,verified_name,quality_rating,account_mode,messaging_limit_tier,code_verification_status,name_status,status`);
  // Modelli del WABA: serve l'id dell'account WhatsApp Business, ricavato dal token con le credenziali dell'app Meta.
  const appId = process.env.META_APP_ID, appSecret = process.env.META_APP_SECRET;
  let wabaId = "";
  {
    const accessTok = appId && appSecret ? `${appId}|${appSecret}` : cfg.token; // senza credenziali dell'app si prova col token stesso
    const dbg = await (async () => { try { const r = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(cfg.token)}&access_token=${encodeURIComponent(accessTok)}`); return await r.json(); } catch { return null; } })();
    const scopes = (dbg?.data?.granular_scopes ?? []) as { scope: string; target_ids?: string[] }[];
    wabaId = scopes.find((x) => x.scope === "whatsapp_business_management")?.target_ids?.[0] ?? "";
    out.token = { valid: dbg?.data?.is_valid ?? null, expires: dbg?.data?.expires_at ?? null, type: dbg?.data?.type ?? null };
    if (dbg?.error) out.tokenError = dbg.error.message;
  }
  if (wabaId) {
    out.wabaId = wabaId;
    const t = await get(`${wabaId}/message_templates?fields=name,status,language,category,components&limit=50`);
    out.templates = t.ok ? (((t as { data: { data?: { name: string; status: string; language: string; category: string }[] } }).data.data ?? []).map((x) => ({ name: x.name, status: x.status, language: x.language, category: x.category }))) : t;
  }
  out.expectedTemplate = process.env.WHATSAPP_PULIZIE_TEMPLATE || "planning_pulizie";
  return out;
}
