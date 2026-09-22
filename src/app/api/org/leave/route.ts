import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L'utente INVITATO abbandona una struttura condivisa (rimuove SOLO la propria membership).
// Il proprietario non usa questa rotta: per togliere la condivisione usa /api/org/unshare.

type J = Record<string, unknown>;
const arr = (x: unknown): J[] => (Array.isArray(x) ? (x as J[]) : []);
const DATA_KEY = "spigolestay:data:v1";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    let orgId = String(body?.orgId || "").trim();
    const structureId = String(body?.structureId || "").trim();

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (!caller?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // Ricava orgId dalla struttura, se non passato.
    if (!orgId && structureId) {
      const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", caller.id);
      for (const m of arr(ms)) {
        const oid = String(m.org_id || "");
        const { data: os } = await admin.from("org_state").select("data").eq("org_id", oid).maybeSingle();
        let od: J = {}; try { od = JSON.parse(((os?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as J; } catch { od = {}; }
        if (arr(od.structures).some((s) => s?.id === structureId)) { orgId = oid; break; }
      }
    }
    if (!orgId) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Verifica il ruolo: il PROPRIETARIO non può "abbandonare" (deve usare unshare).
    const { data: mine } = await admin.from("memberships").select("role").eq("org_id", orgId).eq("user_id", caller.id).maybeSingle();
    if (!mine) return NextResponse.json({ error: "not_member" }, { status: 404 });
    if (mine.role === "owner") return NextResponse.json({ error: "owner_cannot_leave", message: "Sei il proprietario: usa 'Rimuovi condivisione'." }, { status: 400 });

    await admin.from("memberships").delete().eq("org_id", orgId).eq("user_id", caller.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
