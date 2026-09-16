// Helper condiviso per le route API di fatturazione: verifica il bearer token e
// restituisce il client service-role + il tenantId (= utente proprietario).
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthOk { admin: SupabaseClient; tenantId: string }

export async function authTenant(req: Request): Promise<AuthOk | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error } = await admin.auth.getUser(token);
  if (error || !who?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return { admin, tenantId: who.user.id };
}

export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;
