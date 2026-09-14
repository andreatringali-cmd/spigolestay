import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Accettazione di un invito a co-gestire una struttura.
//  - verifica l'utente chiamante e che la sua email coincida con quella invitata;
//  - crea la membership (member) e segna l'invito come accettato.
// Dopo, il client dell'invitato scarica la struttura condivisa da org_state (sync).

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
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (whoErr || !caller?.id || !caller.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { data: inv } = await admin.from("org_invites").select("*").eq("code", code).maybeSingle();
    if (!inv) return NextResponse.json({ error: "invite_not_found" }, { status: 404 });
    if (inv.status === "revoked") return NextResponse.json({ error: "invite_revoked" }, { status: 410 });
    if (String(inv.email).toLowerCase() !== caller.email.toLowerCase())
      return NextResponse.json({ error: "email_mismatch", invitedEmail: inv.email }, { status: 403 });

    // Crea la membership se non esiste già.
    const { data: existing } = await admin.from("memberships").select("id").eq("org_id", inv.org_id).eq("user_id", caller.id).maybeSingle();
    if (!existing) {
      const { error: mErr } = await admin.from("memberships").insert({ org_id: inv.org_id, user_id: caller.id, role: "member" });
      if (mErr) return NextResponse.json({ error: "membership_failed", message: mErr.message }, { status: 500 });
    }
    if (inv.status !== "accepted") {
      await admin.from("org_invites").update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: caller.id }).eq("code", code);
    }

    return NextResponse.json({ ok: true, orgId: inv.org_id, structureName: inv.structure_name ?? null });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
