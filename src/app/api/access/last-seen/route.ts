import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ultimo accesso reale delle persone invitate (colonna "Ultimo accesso" in Utenti). Il dato sta nell'autenticazione, non nel profilo locale:
// il profilo creato dal titolare non lo sa. Restituisce {email → data ISO | null}.
// Visibilità: l'amministratore di Xenora vede tutte le email richieste; un titolare solo chi è membro di una sua organizzazione.

const ADMINS = (process.env.ADMIN_EMAILS || "spigolehouse@gmail.com,andreatringali.spi@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const wanted = (Array.isArray(body?.emails) ? body.emails : []).map((e: unknown) => String(e ?? "").trim().toLowerCase()).filter(Boolean).slice(0, 100) as string[];
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (!caller?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let allowed = new Set<string>(wanted);
    if (!ADMINS.includes((caller.email || "").toLowerCase())) {
      // non amministratore: solo i membri delle sue organizzazioni
      const { data: mine } = await admin.from("memberships").select("org_id").eq("user_id", caller.id);
      const orgIds = (mine ?? []).map((m) => m.org_id as string);
      allowed = new Set<string>();
      if (orgIds.length) {
        const { data: mem } = await admin.from("memberships").select("user_id").in("org_id", orgIds);
        const ids = new Set((mem ?? []).map((m) => m.user_id as string));
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        for (const u of list?.users ?? []) if (u.email && ids.has(u.id) && wanted.includes(u.email.toLowerCase())) allowed.add(u.email.toLowerCase());
      }
    }

    const seen: Record<string, string | null> = {};
    if (allowed.size) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const u of list?.users ?? []) {
        const e = (u.email || "").toLowerCase();
        if (e && allowed.has(e)) seen[e] = u.last_sign_in_at ?? null;
      }
    }
    return NextResponse.json({ ok: true, seen });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
