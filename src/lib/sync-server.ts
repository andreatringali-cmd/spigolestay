// Aiuto per le rotte /api/sync/*: un client Supabase che agisce COME L'UTENTE (con il suo token), così le regole di sicurezza del database (RLS) valgono
// esattamente come quando scrive il browser: nessun permesso da ricostruire a mano nel server.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SyncAuth { userClient: SupabaseClient; userId: string }

export async function syncAuth(req: Request): Promise<SyncAuth | { status: number; error: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { status: 503, error: "supabase_not_configured" };
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { status: 401, error: "unauthorized" };
  const userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user?.id) return { status: 401, error: "unauthorized" };
  return { userClient, userId: data.user.id };
}

export type SyncTable = "app_state" | "org_state";
export const idColOf = (t: SyncTable): "user_id" | "org_id" => (t === "app_state" ? "user_id" : "org_id");
export const isSyncTable = (t: unknown): t is SyncTable => t === "app_state" || t === "org_state";
