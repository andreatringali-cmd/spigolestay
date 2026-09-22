import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rimuove la CONDIVISIONE di una struttura: la riporta nell'account PERSONALE del
// proprietario (da org_state ad app_state, orgId annullato) e smantella l'organizzazione
// (memberships, org_state, organizations, inviti). Il socio perde l'accesso.
// Solo il PROPRIETARIO (owner) dell'organizzazione può farlo.

const DATA_KEY = "spigolestay:data:v1";
type J = Record<string, unknown>;
const arr = (x: unknown): J[] => (Array.isArray(x) ? (x as J[]) : []);

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const structureId = String(body?.structureId || "").trim();
    if (!structureId) return NextResponse.json({ error: "missing_structure" }, { status: 400 });

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (!caller?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // Trova l'org (di cui il chiamante è OWNER) che contiene questa struttura.
    const { data: mships } = await admin.from("memberships").select("org_id, role").eq("user_id", caller.id);
    let orgId = "", orgData: J | null = null;
    for (const m of arr(mships)) {
      const oid = m.org_id as string;
      const { data: os } = await admin.from("org_state").select("data").eq("org_id", oid).maybeSingle();
      let od: J = {}; try { od = JSON.parse(((os?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as J; } catch { od = {}; }
      if (arr(od.structures).some((s) => s?.id === structureId)) {
        if (m.role !== "owner") return NextResponse.json({ error: "not_owner", message: "Solo il proprietario può rimuovere la condivisione." }, { status: 403 });
        orgId = oid; orgData = od; break;
      }
    }
    if (!orgId || !orgData) return NextResponse.json({ error: "not_shared", message: "Struttura non condivisa o non trovata." }, { status: 404 });

    // Migra la struttura (e ciò che le appartiene) da org_state → app_state personale del proprietario.
    const { data: row } = await admin.from("app_state").select("data").eq("user_id", caller.id).maybeSingle();
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    let d: J = {}; try { d = JSON.parse(blob[DATA_KEY] || "{}") as J; } catch { d = {}; }

    const S = arr(orgData.structures).find((s) => s?.id === structureId) as J | undefined;
    const personalStruct = { ...(S || { id: structureId }), orgId: undefined };
    const byId = (list: J[], add: J[]) => { const m = new Map<string, J>(); for (const it of list) { const id = it?.id as string; if (id) m.set(id, it); } for (const it of add) { const id = it?.id as string; if (id) m.set(id, it); } return [...m.values()]; };

    d.structures = byId(arr(d.structures).filter((s) => s?.id !== structureId), [personalStruct]);
    d.roomTypes = byId(arr(d.roomTypes), arr(orgData.roomTypes).filter((rt) => rt?.structureId === structureId));
    d.units = byId(arr(d.units), arr(orgData.units).filter((u) => u?.structureId === structureId));
    d.bookings = byId(arr(d.bookings), arr(orgData.bookings).filter((b) => b?.structureId === structureId));
    d.guests = byId(arr(d.guests), arr(orgData.guests)); // gli ospiti citati tornano/rimangono nel personale
    const ro = (d.rateOverrides && typeof d.rateOverrides === "object") ? d.rateOverrides as Record<string, number> : {};
    const oro = (orgData.rateOverrides && typeof orgData.rateOverrides === "object") ? orgData.rateOverrides as Record<string, number> : {};
    d.rateOverrides = { ...ro, ...oro };
    blob[DATA_KEY] = JSON.stringify(d);
    const { error: upErr } = await admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", caller.id);
    if (upErr) return NextResponse.json({ error: "app_state_failed", message: upErr.message }, { status: 500 });

    // Smantella l'organizzazione: inviti, membership, stato condiviso, record org.
    await admin.from("org_invites").delete().eq("org_id", orgId);
    await admin.from("memberships").delete().eq("org_id", orgId);
    await admin.from("org_state").delete().eq("org_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
