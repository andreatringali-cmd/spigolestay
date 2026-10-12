// Google Business Profile (ex Google My Business): legge TUTTE le recensioni di una sede e pubblica le risposte.
// Serve il consenso OAuth di chi gestisce il profilo (le Places API sono di sola lettura e danno ~5 recensioni).
// Il token (access + refresh) sta cifrato in `provider_credentials` (provider = "googlebusiness"), come per Fatture in Cloud.
// Per struttura si salva quale sede Google usare: config.locations = { [structureId]: { account, location, title } }.
//
// Env (Vercel, solo lato server): GBP_CLIENT_ID, GBP_CLIENT_SECRET (client OAuth "Applicazione web" del progetto Google Cloud,
// con l'URI di reindirizzamento https://xenora.it/api/google-business/callback). Facoltativa: GBP_REDIRECT_URI.
// Le API da abilitare sul progetto: Business Profile API (mybusiness), Account Management API, Business Information API.
// Google concede l'accesso alle Business Profile API solo dopo l'approvazione del progetto: finché non c'è, le chiamate
// rispondono con quota 0 e qui si traduce in un messaggio chiaro (gbpErrorMessage).

import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptCred, decryptCred } from "@/lib/crypto-creds";
import { signState, verifyState } from "@/lib/invoicing/fic-oauth";

export { signState, verifyState };

const PROVIDER = "googlebusiness";
export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const INFO_URL = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4_URL = "https://mybusiness.googleapis.com/v4";

export const gbpConfigured = (): boolean => !!process.env.GBP_CLIENT_ID && !!process.env.GBP_CLIENT_SECRET;

export function gbpAuthorizeUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.GBP_CLIENT_ID || "",
    redirect_uri: redirectUri,
    scope: GBP_SCOPE,
    access_type: "offline", // serve il refresh token
    prompt: "consent",       // Google lo dà solo al primo consenso: si forza per riaverlo ai ricollegamenti
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

interface TokenResp { access_token: string; refresh_token?: string; expires_in?: number }

async function tokenRequest(form: Record<string, string>): Promise<TokenResp> {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form), cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !j.access_token) throw new Error(`google_token_${res.status}:${String(j.error || "")}`);
  return j as unknown as TokenResp;
}
export const exchangeGbpCode = (code: string, redirectUri: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: process.env.GBP_CLIENT_ID || "", client_secret: process.env.GBP_CLIENT_SECRET || "" });
const refreshGbp = (refresh: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refresh, client_id: process.env.GBP_CLIENT_ID || "", client_secret: process.env.GBP_CLIENT_SECRET || "" });

// ---- Persistenza --------------------------------------------------------------
export interface GbpLocation { account: string; location: string; title: string }
interface GbpConfig { refresh_token_enc?: string; access_token_enc?: string; expires_at?: number; connected_at?: string; locations?: Record<string, GbpLocation> }

async function readConfig(admin: SupabaseClient, tenantId: string): Promise<GbpConfig | null> {
  const { data } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", PROVIDER).maybeSingle();
  const c = data?.config as GbpConfig | undefined;
  return c && c.refresh_token_enc ? c : null;
}
async function writeConfig(admin: SupabaseClient, tenantId: string, config: GbpConfig): Promise<void> {
  await admin.from("provider_credentials").upsert({ tenant_id: tenantId, provider: PROVIDER, config, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,provider" });
}

export async function saveGbpTokens(admin: SupabaseClient, tenantId: string, t: TokenResp): Promise<void> {
  const { data } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", PROVIDER).maybeSingle();
  const prev = (data?.config as GbpConfig | undefined) ?? {};
  // Se Google non rimanda il refresh token (già concesso) si tiene quello che c'è.
  const refresh = t.refresh_token ? encryptCred(t.refresh_token) : prev.refresh_token_enc;
  if (!refresh) throw new Error("google_no_refresh_token");
  await writeConfig(admin, tenantId, {
    ...prev,
    refresh_token_enc: refresh,
    access_token_enc: encryptCred(t.access_token),
    expires_at: Date.now() + (t.expires_in || 3600) * 1000,
    connected_at: prev.connected_at || new Date().toISOString(),
  });
}

export async function gbpStatus(admin: SupabaseClient, tenantId: string): Promise<{ connected: boolean; locations: Record<string, GbpLocation> }> {
  const c = await readConfig(admin, tenantId);
  return { connected: !!c, locations: c?.locations ?? {} };
}

export async function setGbpLocation(admin: SupabaseClient, tenantId: string, structureId: string, loc: GbpLocation | null): Promise<boolean> {
  const c = await readConfig(admin, tenantId);
  if (!c) return false;
  const locations = { ...(c.locations ?? {}) };
  if (loc) locations[structureId] = loc; else delete locations[structureId];
  await writeConfig(admin, tenantId, { ...c, locations });
  return true;
}

export async function disconnectGbp(admin: SupabaseClient, tenantId: string): Promise<void> {
  await admin.from("provider_credentials").delete().eq("tenant_id", tenantId).eq("provider", PROVIDER);
}

/** Access token valido (rinnovato se scade entro 5 minuti). Lancia "gbp_not_connected" o "gbp_reauth" (consenso revocato/scaduto). */
export async function gbpAccessToken(admin: SupabaseClient, tenantId: string): Promise<string> {
  const c = await readConfig(admin, tenantId);
  if (!c) throw new Error("gbp_not_connected");
  const access = decryptCred(c.access_token_enc);
  if (access && (c.expires_at ?? 0) > Date.now() + 5 * 60 * 1000) return access;
  const refresh = decryptCred(c.refresh_token_enc);
  if (!refresh) throw new Error("gbp_reauth");
  try {
    const t = await refreshGbp(refresh);
    await writeConfig(admin, tenantId, { ...c, access_token_enc: encryptCred(t.access_token), expires_at: Date.now() + (t.expires_in || 3600) * 1000 });
    return t.access_token;
  } catch (e) {
    if (/invalid_grant/.test(String((e as Error)?.message))) throw new Error("gbp_reauth");
    throw e;
  }
}

// ---- Chiamate alle API --------------------------------------------------------
export interface GRes<T> { ok: boolean; status: number; data?: T; error?: string }
async function g<T>(url: string, token: string, init?: { method?: string; body?: unknown }): Promise<GRes<T>> {
  try {
    const res = await fetch(url, {
      method: init?.method || "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = undefined;
    try { data = text ? JSON.parse(text) : undefined; } catch { /* corpo non JSON */ }
    if (!res.ok) {
      const err = (data as { error?: { message?: string; status?: string } } | undefined)?.error;
      return { ok: false, status: res.status, error: [err?.status, err?.message].filter(Boolean).join(": ") || text.slice(0, 200) };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch (e) { return { ok: false, status: 0, error: (e as Error)?.message || "rete" }; }
}

/** Messaggio in italiano per l'errore di una chiamata Google (mostrato nella pagina Recensioni). */
export function gbpErrorMessage(status: number, error?: string): string {
  const e = error || "";
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(e)) return "Su Google Cloud manca da abilitare una delle API (Business Profile, Account Management o Business Information) per il progetto.";
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(e)) return "Google non ha ancora concesso al progetto l'accesso alle API Business Profile (quota a zero): la richiesta di accesso va approvata da Google. Appena approvata funziona da sola.";
  if (status === 401) return "Il consenso a Google è scaduto: ricollega l'account.";
  if (status === 403) return "L'account Google collegato non gestisce questa sede, oppure Google non ha ancora approvato l'accesso alle API.";
  if (status === 404) return "Recensione o sede non trovata su Google.";
  if (status === 0) return "Google non risponde: riprova tra poco.";
  return `Google ha risposto con un errore (${status}).`;
}

export async function listGbpAccounts(token: string): Promise<GRes<{ name: string; accountName?: string; type?: string }[]>> {
  const r = await g<{ accounts?: { name: string; accountName?: string; type?: string }[] }>(ACCOUNTS_URL, token);
  return r.ok ? { ok: true, status: r.status, data: r.data?.accounts ?? [] } : { ok: false, status: r.status, error: r.error };
}

export async function listGbpLocations(token: string, account: string): Promise<GRes<GbpLocation[]>> {
  const out: GbpLocation[] = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ readMask: "name,title", pageSize: "100" });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await g<{ locations?: { name: string; title?: string }[]; nextPageToken?: string }>(`${INFO_URL}/${account}/locations?${q.toString()}`, token);
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    for (const l of r.data?.locations ?? []) out.push({ account, location: l.name, title: l.title || l.name });
    pageToken = r.data?.nextPageToken || "";
    if (!pageToken) break;
  }
  return { ok: true, status: 200, data: out };
}

// ---- Recensioni ---------------------------------------------------------------
export interface GbpReviewRow {
  id: string;         // chiave UI: "gbp-<reviewId>"
  reviewName: string; // "accounts/…/locations/…/reviews/…" (serve per rispondere)
  guest: string;
  date: string;       // ISO YYYY-MM-DD
  rating: number;     // 0..10 (stelle × 2)
  text: string;
  source: "google";
  bucket: "pos" | "neu" | "neg";
  isReplied: boolean;
  reply: string | null;
}
interface RawReview { reviewId?: string; name?: string; reviewer?: { displayName?: string; isAnonymous?: boolean }; starRating?: string; comment?: string; createTime?: string; updateTime?: string; reviewReply?: { comment?: string } }

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export const starsToScore = (s?: string): number => (STARS[String(s || "").replace(/_STAR$/, "")] ?? 0) * 2;
const bucketOf = (r10: number): "pos" | "neu" | "neg" => (r10 >= 8 ? "pos" : r10 >= 6 ? "neu" : "neg");

export function normalizeGbpReview(r: RawReview): GbpReviewRow | null {
  const reviewName = String(r.name || "");
  const reviewId = String(r.reviewId || reviewName.split("/").pop() || "");
  if (!reviewId || !reviewName) return null;
  const rating = starsToScore(r.starRating);
  const dateRaw = r.createTime || r.updateTime || "";
  const reply = (r.reviewReply?.comment || "").trim();
  return {
    id: `gbp-${reviewId}`,
    reviewName,
    guest: r.reviewer?.isAnonymous ? "Utente Google" : (r.reviewer?.displayName || "").trim() || "Utente Google",
    date: /^\d{4}-\d{2}-\d{2}/.test(dateRaw) ? dateRaw.slice(0, 10) : new Date().toISOString().slice(0, 10),
    rating,
    text: (r.comment || "").trim(),
    source: "google",
    bucket: bucketOf(rating),
    isReplied: !!reply,
    reply: reply || null,
  };
}

/** Tutte le recensioni di una sede (pagina per pagina, con un tetto di sicurezza). */
export async function listGbpReviews(token: string, loc: { account: string; location: string }): Promise<GRes<{ reviews: GbpReviewRow[]; average?: number; total?: number }>> {
  const reviews: GbpReviewRow[] = [];
  let pageToken = "", average: number | undefined, total: number | undefined;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await g<{ reviews?: RawReview[]; nextPageToken?: string; averageRating?: number; totalReviewCount?: number }>(`${V4_URL}/${loc.account}/${loc.location}/reviews?${q.toString()}`, token);
    if (!r.ok) return i === 0 ? { ok: false, status: r.status, error: r.error } : { ok: true, status: 200, data: { reviews, average, total } };
    for (const raw of r.data?.reviews ?? []) { const n = normalizeGbpReview(raw); if (n) reviews.push(n); }
    average = r.data?.averageRating ?? average; total = r.data?.totalReviewCount ?? total;
    pageToken = r.data?.nextPageToken || "";
    if (!pageToken) break;
  }
  return { ok: true, status: 200, data: { reviews, average, total } };
}

/** La recensione appartiene a questa sede? (il nome arriva dal client: si controlla il prefisso) */
export const reviewBelongsTo = (reviewName: string, loc: { account: string; location: string }): boolean =>
  reviewName.startsWith(`${loc.account}/${loc.location}/reviews/`) && !reviewName.includes("..") && reviewName.split("/").length === 6;

export async function replyGbpReview(token: string, reviewName: string, comment: string): Promise<GRes<unknown>> {
  return g(`${V4_URL}/${reviewName}/reply`, token, { method: "PUT", body: { comment } });
}

export const isAccountName = (s: unknown): s is string => typeof s === "string" && /^accounts\/\d+$/.test(s);
export const isLocationName = (s: unknown): s is string => typeof s === "string" && /^locations\/\d+$/.test(s);
