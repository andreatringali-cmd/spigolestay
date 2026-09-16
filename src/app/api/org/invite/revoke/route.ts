import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Elimina un invito ANCORA IN ATTESA (pending). Solo chi l'ha inviato.
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim();
    if (!code) return NextResponse.json({ error: "missing_code" }, { status: 400 });

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (!caller?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { data: inv } = await admin.from("org_invites").select("status, invited_by").eq("code", code).maybeSingle();
    if (!inv) return NextResponse.json({ error: "invite_not_found" }, { status: 404 });
    if (inv.invited_by !== caller.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (inv.status === "accepted") return NextResponse.json({ error: "already_accepted", message: "L'invito è già stato accettato: non è eliminabile." }, { status: 400 });

    const { error } = await admin.from("org_invites").delete().eq("code", code).eq("invited_by", caller.id);
    if (error) return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
