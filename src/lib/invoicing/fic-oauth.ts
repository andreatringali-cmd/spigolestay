// Fatture in Cloud — OAuth2 Authorization Code flow + token store per-tenant.
//
// Ogni tenant (struttura o l'account piattaforma Xenora) collega il PROPRIO
// account Fatture in Cloud: da lì la fattura viene creata e inviata allo SdI da
// Fatture in Cloud stesso. I token (access + refresh) sono cifrati in
// `provider_credentials` (provider = "fattureincloud"), come per gli altri
// intermediari. L'access token dura 24h → si rinnova col refresh token (1 anno).
//
// Doc ufficiale: https://developers.fattureincloud.it/docs/authentication/code-flow/
// Endpoint confermati:
//   authorize: GET  https://api-v2.fattureincloud.it/oauth/authorize
//   token:     POST https://api-v2.fattureincloud.it/oauth/token
//   companies: GET  https://api-v2.fattureincloud.it/user/companies
//
// SICUREZZA: FIC_CLIENT_ID / FIC_CLIENT_SECRET stanno solo lato server (env).
// Lo `state` OAuth è firmato HMAC con CRED_SECRET per legare il callback al tenant.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { encryptCred, decryptCred } from "@/lib/crypto-creds";

export const FIC_API_BASE = "https://api-v2.fattureincloud.it";
const AUTH_URL = `${FIC_API_BASE}/oauth/authorize`;
const TOKEN_URL = `${FIC_API_BASE}/oauth/token`;
const PROVIDER = "fattureincloud";

// Scope: gestione clienti + fatture emesse + lettura/scrittura impostazioni azienda.
export const FIC_SCOPES = "entity.clients:a issued_documents.invoices:a settings:a";

export function ficConfigured(): boolean {
  return !!process.env.FIC_CLIENT_ID && !!process.env.FIC_CLIENT_SECRET;
}

// ---- Stato firmato (lega il redirect al tenant, anti-CSRF) --------------------
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function stateSecret(): string { return process.env.CRED_SECRET || "xenora-fic-state"; }

export function signState(tenantId: string): string {
  const payload = `${tenantId}.${Date.now()}.${randomBytes(8).toString("hex")}`;
  const sig = b64url(createHmac("sha256", stateSecret()).update(payload).digest());
  return `${b64url(Buffer.from(payload))}.${sig}`;
}
export function verifyState(state: string): { tenantId: string } | null {
  try {
    const [pB64, sig] = (state || "").split(".");
    if (!pB64 || !sig) return null;
    const payload = fromB64url(pB64).toString("utf8");
    const expected = b64url(createHmac("sha256", stateSecret()).update(payload).digest());
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [tenantId, ts] = payload.split(".");
    if (!tenantId || !ts) return null;
    if (Date.now() - Number(ts) > 15 * 60 * 1000) return null; // scaduto (15 min)
    return { tenantId };
  } catch { return null; }
}

// ---- URL di autorizzazione ----------------------------------------------------
export function ficAuthorizeUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.FIC_CLIENT_ID || "",
    redirect_uri: redirectUri,
    scope: FIC_SCOPES,
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

// ---- Scambio/refresh token ----------------------------------------------------
interface TokenResp { token_type: string; access_token: string; refresh_token: string; expires_in: number }

async function tokenRequest(body: Record<string, string>): Promise<TokenResp> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
  if (!res.ok || !json.access_token) {
    throw new Error(`Fatture in Cloud OAuth ${res.status}: ${(json.error_description as string) || (json.error as string) || "token non ottenuto"}`);
  }
  return json as unknown as TokenResp;
}

export function exchangeCode(code: string, redirectUri: string): Promise<TokenResp> {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: process.env.FIC_CLIENT_ID || "",
    client_secret: process.env.FIC_CLIENT_SECRET || "",
    redirect_uri: redirectUri,
    code,
  });
}
export function refreshToken(refresh: string): Promise<TokenResp> {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: process.env.FIC_CLIENT_ID || "",
    client_secret: process.env.FIC_CLIENT_SECRET || "",
    refresh_token: refresh,
  });
}

// ---- Aziende dell'utente ------------------------------------------------------
export interface FicCompany { id: number; name: string; type?: string; access_token?: string }
export async function listCompanies(accessToken: string): Promise<FicCompany[]> {
  const res = await fetch(`${FIC_API_BASE}/user/companies`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Fatture in Cloud /user/companies ${res.status}`);
  const data = (json?.data ?? {}) as { companies?: FicCompany[] };
  return Array.isArray(data.companies) ? data.companies : [];
}

// ---- Persistenza (provider_credentials, cifrata) ------------------------------
interface FicRecord { accessToken: string; refreshToken: string; companyId: string; companyName: string; expiresAt: number; dryRun: boolean }

export async function saveFicTokens(
  admin: SupabaseClient, tenantId: string,
  tokens: TokenResp, opts: { companyId?: string | number; companyName?: string; dryRun?: boolean } = {},
): Promise<void> {
  const { data: existing } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", PROVIDER).maybeSingle();
  const prev = (existing?.config as Record<string, unknown>) ?? {};
  const config: Record<string, unknown> = {
    ...prev,
    access_token_enc: encryptCred(tokens.access_token),
    refresh_token_enc: encryptCred(tokens.refresh_token),
    expires_at: Date.now() + (tokens.expires_in || 86400) * 1000,
    connected_at: prev.connected_at || new Date().toISOString(),
  };
  if (opts.companyId != null) config.company_id = String(opts.companyId);
  if (opts.companyName != null) config.company_name = opts.companyName;
  if (opts.dryRun != null) config.dry_run = !!opts.dryRun;
  await admin.from("provider_credentials").upsert(
    { tenant_id: tenantId, provider: PROVIDER, config, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,provider" },
  );
}

async function getFicRecord(admin: SupabaseClient, tenantId: string): Promise<FicRecord | null> {
  const { data } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", PROVIDER).maybeSingle();
  const c = (data?.config as Record<string, unknown>) ?? {};
  const refreshEnc = c.refresh_token_enc as string | undefined;
  if (!refreshEnc) return null;
  return {
    accessToken: decryptCred(c.access_token_enc as string),
    refreshToken: decryptCred(refreshEnc),
    companyId: (c.company_id as string) || "",
    companyName: (c.company_name as string) || "",
    expiresAt: (c.expires_at as number) || 0,
    dryRun: !!c.dry_run,
  };
}

// Config pronta per l'invio: rinnova l'access token se scaduto/in scadenza e la persiste.
export async function resolveFicSendConfig(admin: SupabaseClient, tenantId: string): Promise<{ accessToken: string; companyId: string; dryRun: boolean }> {
  const rec = await getFicRecord(admin, tenantId);
  if (!rec || !rec.refreshToken) throw new Error("fattureincloud_not_connected");
  if (!rec.companyId) throw new Error("fattureincloud_no_company");
  let accessToken = rec.accessToken;
  // Rinnova se manca o scade entro 5 minuti.
  if (!accessToken || Date.now() > rec.expiresAt - 5 * 60 * 1000) {
    const t = await refreshToken(rec.refreshToken);
    await saveFicTokens(admin, tenantId, t, { companyId: rec.companyId, companyName: rec.companyName, dryRun: rec.dryRun });
    accessToken = t.access_token;
  }
  return { accessToken, companyId: rec.companyId, dryRun: rec.dryRun };
}

export async function ficStatus(admin: SupabaseClient, tenantId: string): Promise<{ connected: boolean; companyName: string; companyId: string; dryRun: boolean; expiresAt: number }> {
  const rec = await getFicRecord(admin, tenantId);
  return { connected: !!rec?.refreshToken && !!rec?.companyId, companyName: rec?.companyName || "", companyId: rec?.companyId || "", dryRun: !!rec?.dryRun, expiresAt: rec?.expiresAt || 0 };
}

export async function setFicDryRun(admin: SupabaseClient, tenantId: string, dryRun: boolean): Promise<void> {
  const { data } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", PROVIDER).maybeSingle();
  const config = { ...((data?.config as Record<string, unknown>) ?? {}), dry_run: !!dryRun };
  await admin.from("provider_credentials").upsert({ tenant_id: tenantId, provider: PROVIDER, config, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,provider" });
}

export async function disconnectFic(admin: SupabaseClient, tenantId: string): Promise<void> {
  await admin.from("provider_credentials").delete().eq("tenant_id", tenantId).eq("provider", PROVIDER);
}
