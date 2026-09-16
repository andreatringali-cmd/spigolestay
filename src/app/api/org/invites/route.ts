import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Registro inviti: elenca gli inviti mandati per una struttura (con stato pending/accettato).
// Auth via bearer token; ritorna gli inviti dove il chiamante è l'invitante.

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const structureId = new URL(req.url).searchParams.get("structureId") || "";
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (!caller?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // Inviti mandati dal chiamante per questa struttura (più recenti prima).
    const { data, error } = await admin.from("org_invites")
      .select("email, status, created_at, accepted_at")
      .eq("structure_id", structureId)
      .eq("invited_by", caller.id)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: "read_error", message: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, invites: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
