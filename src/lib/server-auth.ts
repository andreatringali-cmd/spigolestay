// Autenticazione lato SERVER condivisa dalle route API.
//  - requireUser: utente loggato (bearer Supabase) E ammesso (accesso su invito) — controllo reale sul server,
//    non solo nel browser.
//  - internalFetch / isInternalRequest: chiamate tra le nostre stesse route (webhook, cron, conferme → /api/email…).
//    Si firmano con un HMAC derivato dalla chiave di servizio, che esiste solo sul server: nessuna nuova variabile da impostare.
//  - siteOrigin: base URL fissa del sito. MAI l'header Origin della richiesta (si può falsificare: phishing e SSRF).
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const INTERNAL_HEADER = "x-xenora-internal";

function internalToken(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createHmac("sha256", key).update("xenora-internal-v1").digest("hex");
}

/** Vero se la richiesta arriva da un'altra route di Xenora (firma valida). */
export function isInternalRequest(req: Request): boolean {
  const want = internalToken();
  const got = req.headers.get(INTERNAL_HEADER) || "";
  if (!want || got.length !== want.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(want)); } catch { return false; }
}

/** fetch verso una nostra route interna, con la firma. */
export function internalFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const tok = internalToken();
  if (tok) headers.set(INTERNAL_HEADER, tok);
  return fetch(input, { ...init, headers });
}

/** Base URL del sito (fissa). In locale usa l'origine della richiesta. */
export function siteOrigin(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/+$/, "");
  try {
    const u = new URL(req.url);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return u.origin;
  } catch { /* url non valido */ }
  return "https://xenora.it";
}

const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export const isOwnerEmail = (email: string) => OWNER_EMAILS.includes((email || "").toLowerCase());

// Cache breve: evita 4 query a ogni chiamata API dello stesso utente.
const allowCache = new Map<string, { ok: boolean; at: number }>();
const ALLOW_TTL_MS = 60_000;

/** Accesso su invito: stesse regole di /api/access/status, ma applicate dal server a ogni chiamata. */
export async function isUserAllowed(admin: SupabaseClient, user: User): Promise<boolean> {
  const hit = allowCache.get(user.id);
  if (hit && Date.now() - hit.at < ALLOW_TTL_MS) return hit.ok;
  const email = (user.email || "").toLowerCase();
  let ok = false;
  if (email && OWNER_EMAILS.includes(email)) ok = true;
  if (!ok) {
    const { data: st } = await admin.from("app_state").select("user_id").eq("user_id", user.id).maybeSingle();
    if (st) ok = true;
  }
  if (!ok) {
    const { data: mem } = await admin.from("memberships").select("org_id").eq("user_id", user.id).limit(1);
    if (mem && mem.length) ok = true;
  }
  if (!ok && email) {
    const { data: inv } = await admin.from("org_invites").select("id").eq("email", email).is("accepted_at", null).limit(1);
    if (inv && inv.length) ok = true;
  }
  if (!ok && email) {
    const { data: al } = await admin.from("access_allowlist").select("email").eq("email", email).maybeSingle();
    if (al) ok = true;
  }
  allowCache.set(user.id, { ok, at: Date.now() });
  return ok;
}

export interface UserOk { admin: SupabaseClient; user: User; userId: string; email: string }

/** Richiede un utente loggato e ammesso. Ritorna la risposta di errore da restituire, oppure i dati dell'utente. */
export async function requireUser(req: Request): Promise<UserOk | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error } = await admin.auth.getUser(token);
  if (error || !who?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    if (!(await isUserAllowed(admin, who.user))) return NextResponse.json({ error: "not_approved" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "access_check_failed" }, { status: 503 }); // nel dubbio si nega (fail-closed)
  }
  return { admin, user: who.user, userId: who.user.id, email: (who.user.email || "").toLowerCase() };
}

export const isErr = (x: unknown): x is NextResponse => x instanceof NextResponse;

// Limite per utente (in memoria, per istanza): protegge da cicli impazziti e da abusi di un account.
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) { for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k); }
  return false;
}

/** Solo URL http(s): scarta javascript:, data: ecc. */
export const safeHttpUrl = (u: unknown): string | undefined => {
  const s = typeof u === "string" ? u.trim() : "";
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : undefined;
};
/** Solo colori esadecimali (finiscono dentro attributi style). */
export const safeColor = (c: unknown): string | undefined => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : undefined);
