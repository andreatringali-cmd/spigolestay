import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, listChannels, setChannelActive } from "@/lib/channex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Attiva/disattiva un canale OTA già collegato, dal pulsante nella pagina Canali.
// POST /api/channex/channel (bearer) { channelId, active } → { ok, error? }
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const body = await req.json().catch(() => ({}));
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const active = body.active === true;
  if (!channelId) return NextResponse.json({ ok: false, error: "channelId mancante" }, { status: 400 });

  const { data: personalRows } = await auth.admin.from("channex_map").select("channex_property_id").eq("tenant_id", auth.tenantId).is("org_id", null);
  const { data: mships } = await auth.admin.from("memberships").select("org_id").eq("user_id", auth.tenantId);
  const orgIds = Array.from(new Set((mships ?? []).map((m) => m.org_id as string).filter(Boolean)));
  const orgRows: { channex_property_id: string }[] = [];
  for (const oid of orgIds) {
    const { data } = await auth.admin.from("channex_map").select("channex_property_id").eq("org_id", oid);
    orgRows.push(...(data ?? []));
  }
  const propertyIds = [...(personalRows ?? []), ...orgRows].map((r) => r.channex_property_id as string).filter(Boolean);

  // Il canale deve appartenere a una property di QUESTO tenant, altrimenti un tenant potrebbe
  // attivare/disattivare il canale di un altro (channelId arriva dal client, non fidato).
  let owned = false;
  for (const pid of propertyIds) {
    const res = await listChannels(pid);
    if ((res.data?.data ?? []).some((c) => c.id === channelId)) { owned = true; break; }
  }
  if (!owned) return NextResponse.json({ ok: false, error: "Canale non trovato per questo account" }, { status: 404 });

  const res = await setChannelActive(channelId, active);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error || "Operazione non riuscita" }, { status: 200 });
  return NextResponse.json({ ok: true });
}
