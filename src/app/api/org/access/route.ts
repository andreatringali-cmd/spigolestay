import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ritorna, per l'utente collegato, le organizzazioni di cui è membro con RUOLO
// (owner/member), stato (active) e permessi concessi. Il client usa questi dati per
// decidere cosa mostrare/abilitare sulle strutture condivise (mappa per structure.orgId).

type J = Record<string, unknown>;
const arr = (x: unknown): J[] => (Array.isArray(x) ? (x as J[]) : []);
const DATA_KEY = "spigolestay:data:v1";

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: true, orgs: [] });
  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (!caller?.id) return NextResponse.json({ ok: true, orgs: [] });

    const { data: ms } = await admin.from("memberships").select("org_id, role, active, permissions").eq("user_id", caller.id);
    const orgs: J[] = [];
    for (const m of arr(ms)) {
      const orgId = String(m.org_id || "");
      if (!orgId) continue;
      // Nome struttura + nome del proprietario (per il badge "Condivisa da X").
      const { data: os } = await admin.from("org_state").select("data").eq("org_id", orgId).maybeSingle();
      let od: J = {}; try { od = JSON.parse(((os?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as J; } catch { od = {}; }
      const st = arr(od.structures)[0] as J | undefined;
      let ownerEmail = "";
      const { data: owner } = await admin.from("memberships").select("user_id").eq("org_id", orgId).eq("role", "owner").maybeSingle();
      if (owner?.user_id) { const { data: p } = await admin.from("profiles").select("email").eq("user_id", owner.user_id).maybeSingle(); ownerEmail = (p?.email as string) || ""; }
      orgs.push({
        orgId, role: m.role || "member", active: m.active !== false,
        permissions: (m.permissions as J) || null,
        structureId: st?.id || "", structureName: st?.name || "", ownerEmail,
      });
    }
    return NextResponse.json({ ok: true, orgs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? "error", orgs: [] });
  }
}
