import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Note interne del back-office (super-admin) su un cliente: appunti privati del titolare
// su ciascun account. Accesso riservato: solo le email in ADMIN_EMAILS (default: il titolare).
// La tabella admin_customer_notes ha RLS attivo SENZA policy → leggibile/scrivibile solo via service-role.
const OWNER_EMAILS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (!caller?.email || !OWNER_EMAILS.includes(caller.email.toLowerCase())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "").trim();
  const userId = String(body?.userId || "").trim();
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });

  if (action === "save") {
    const note = typeof body?.note === "string" ? body.note : "";
    const { error } = await admin.from("admin_customer_notes").upsert(
      { user_id: userId, note, updated_at: new Date().toISOString(), updated_by: caller.id },
      { onConflict: "user_id" },
    );
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
    return NextResponse.json({ ok: true });
  }

  // default: get
  const { data } = await admin.from("admin_customer_notes").select("note,updated_at").eq("user_id", userId).maybeSingle();
  return NextResponse.json({ ok: true, note: (data?.note as string) || "", updatedAt: (data?.updated_at as string) || null });
}
