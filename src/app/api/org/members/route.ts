import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gestione dei CO-GESTORI di una struttura condivisa (solo il PROPRIETARIO).
//  GET  ?structureId=  -> elenco membri (email, ruolo, attivo, permessi)
//  POST { structureId, userId, permissions?, active?, remove? } -> aggiorna/disattiva/rimuove un membro

type J = Record<string, unknown>;
const arr = (x: unknown): J[] => (Array.isArray(x) ? (x as J[]) : []);
const DATA_KEY = "spigolestay:data:v1";

async function resolveOwnerOrg(admin: SupabaseClient, callerId: string, structureId: string): Promise<string | null> {
  const { data: ms } = await admin.from("memberships").select("org_id, role").eq("user_id", callerId);
  for (const m of arr(ms)) {
    const oid = String(m.org_id || "");
    const { data: os } = await admin.from("org_state").select("data").eq("org_id", oid).maybeSingle();
    let od: J = {}; try { od = JSON.parse(((os?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as J; } catch { od = {}; }
    if (arr(od.structures).some((s) => s?.id === structureId)) return m.role === "owner" ? oid : "__notowner__";
  }
  return null;
}

async function auth(req: Request, admin: SupabaseClient) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data?.user?.id || null;
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const callerId = await auth(req, admin);
  if (!callerId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const structureId = new URL(req.url).searchParams.get("structureId") || "";
  if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });
  const orgId = await resolveOwnerOrg(admin, callerId, structureId);
  if (orgId === "__notowner__") return NextResponse.json({ ok: true, isOwner: false, members: [] });
  if (!orgId) return NextResponse.json({ ok: true, isOwner: false, members: [] });

  const { data: ms } = await admin.from("memberships").select("user_id, role, active, permissions").eq("org_id", orgId);
  const members: J[] = [];
  for (const m of arr(ms)) {
    if (m.role === "owner") continue; // il proprietario non si gestisce come "membro"
    const { data: p } = await admin.from("profiles").select("email, full_name").eq("user_id", m.user_id as string).maybeSingle();
    members.push({ userId: m.user_id, email: (p?.email as string) || "", name: (p?.full_name as string) || "", role: m.role || "member", active: m.active !== false, permissions: (m.permissions as J) || null });
  }
  return NextResponse.json({ ok: true, isOwner: true, orgId, members });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const callerId = await auth(req, admin);
  if (!callerId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const structureId = String(body?.structureId || "").trim();
  const userId = String(body?.userId || "").trim();
  if (!structureId || !userId) return NextResponse.json({ error: "missing_params" }, { status: 400 });

  const orgId = await resolveOwnerOrg(admin, callerId, structureId);
  if (orgId === "__notowner__" || !orgId) return NextResponse.json({ error: "not_owner", message: "Solo il proprietario può gestire i co-gestori." }, { status: 403 });
  if (userId === callerId) return NextResponse.json({ error: "cannot_self" }, { status: 400 });

  // Non si può toccare un altro owner.
  const { data: target } = await admin.from("memberships").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (!target) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
  if (target.role === "owner") return NextResponse.json({ error: "cannot_modify_owner" }, { status: 400 });

  if (body?.remove === true) {
    await admin.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
    return NextResponse.json({ ok: true, removed: true });
  }
  const patch: J = {};
  if (body?.permissions && typeof body.permissions === "object") patch.permissions = body.permissions;
  if (typeof body?.active === "boolean") patch.active = body.active;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });
  const { error } = await admin.from("memberships").update(patch).eq("org_id", orgId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
