import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chi sta entrando è un COLLABORATORE? Xenora è ad invito, i profili sono due:
//  1) titolari: chiedono l'accesso dall'esterno, il titolare di Xenora accetta e si registrano → hanno la guida "registra la tua struttura";
//  2) collaboratori: invitati da un membro già registrato a co-gestire la sua struttura → entrano e vedono solo le strutture di chi li ha invitati.
// È collaboratore chi ha una membership non da titolare (invito accettato) oppure un invito in attesa sulla propria email.
// Gli inviti in attesa sulla SUA email (l'utente è autenticato con quell'email) vengono accettati qui, al primo accesso: non serve cliccare altro.
// Auth via bearer token, service role solo lato server.

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (!caller?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let accepted = 0;
    if (caller.email) {
      const { data: invites } = await admin.from("org_invites").select("code, org_id").ilike("email", caller.email).eq("status", "pending");
      for (const inv of invites ?? []) {
        const { data: existing } = await admin.from("memberships").select("id").eq("org_id", inv.org_id).eq("user_id", caller.id).maybeSingle();
        if (!existing) {
          const { error: mErr } = await admin.from("memberships").insert({ org_id: inv.org_id, user_id: caller.id, role: "member" });
          if (mErr && mErr.code !== "23505") continue; // 23505 = già membro: va bene
        }
        await admin.from("org_invites").update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: caller.id }).eq("code", inv.code);
        accepted += 1;
      }
    }

    // invitato da "Utenti" come collaboratore ma senza ancora strutture condivise: è comunque un collaboratore
    let invitedAsCollaborator = false;
    if (caller.email) {
      const { data: al } = await admin.from("access_allowlist").select("kind").ilike("email", caller.email).maybeSingle();
      invitedAsCollaborator = al?.kind === "collaboratore";
    }

    const { data: ms } = await admin.from("memberships").select("role").eq("user_id", caller.id).neq("role", "owner").limit(1);
    return NextResponse.json({ ok: true, collaborator: invitedAsCollaborator || (ms ?? []).length > 0, accepted });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
