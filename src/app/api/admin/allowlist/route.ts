import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gestione allowlist accessi (SOLO owner). Le email qui elencate possono entrare in Xenora
// (registrazione su invito). GET elenca, POST aggiunge, DELETE rimuove.
const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

async function requireOwner(req: Request): Promise<{ admin: SupabaseClient; email: string } | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error } = await admin.auth.getUser(token);
  const email = (who?.user?.email || "").toLowerCase();
  if (error || !email || !OWNER_EMAILS.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { admin, email };
}

const normEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function GET(req: Request) {
  const a = await requireOwner(req);
  if (a instanceof NextResponse) return a;
  const { data, error } = await a.admin.from("access_allowlist").select("email, note, added_by, created_at").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 200 });
  return NextResponse.json({ ok: true, items: data ?? [] });
}

export async function POST(req: Request) {
  const a = await requireOwner(req);
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => null) as { email?: string; note?: string } | null;
  const email = normEmail(body?.email);
  if (!isEmail(email)) return NextResponse.json({ error: "email_non_valida" }, { status: 400 });
  const note = String(body?.note ?? "").slice(0, 200) || null;
  const { error } = await a.admin.from("access_allowlist").upsert({ email, note, added_by: a.email }, { onConflict: "email" });
  if (error) return NextResponse.json({ error: error.message }, { status: 200 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const a = await requireOwner(req);
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => null) as { email?: string } | null;
  const email = normEmail(body?.email);
  if (!email) return NextResponse.json({ error: "email_mancante" }, { status: 400 });
  // Sicurezza: non permettere di rimuovere un OWNER dalla lista.
  if (OWNER_EMAILS.includes(email)) return NextResponse.json({ error: "owner_non_rimovibile" }, { status: 400 });
  const { error } = await a.admin.from("access_allowlist").delete().eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 200 });
  return NextResponse.json({ ok: true });
}
