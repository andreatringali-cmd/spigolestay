import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, listChannels } from "@/lib/channex";
import { channelFromOta } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stato REALE dei canali OTA collegati su Channex (Booking.com, Airbnb, …), per struttura.
// Sostituisce il vecchio flag locale (mai aggiornato dalla vera integrazione Channex) usato
// dalla legenda del Calendario e dalla pagina Canali per dire "sei collegato".
// POST /api/channex/status (bearer) → { ok, byStructure: { [structureId]: {channel,title,active}[] } }
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const { data: personalRows } = await auth.admin.from("channex_map").select("structure_id, channex_property_id").eq("tenant_id", auth.tenantId).is("org_id", null);
  const { data: mships } = await auth.admin.from("memberships").select("org_id").eq("user_id", auth.tenantId);
  const orgIds = Array.from(new Set((mships ?? []).map((m) => m.org_id as string).filter(Boolean)));
  const orgRows: { structure_id: string; channex_property_id: string }[] = [];
  for (const oid of orgIds) {
    const { data } = await auth.admin.from("channex_map").select("structure_id, channex_property_id").eq("org_id", oid);
    orgRows.push(...(data ?? []));
  }
  const rows = [...(personalRows ?? []), ...orgRows];

  const byStructure: Record<string, { channel: string; title: string; active: boolean }[]> = {};
  for (const r of rows) {
    const sid = r.structure_id as string;
    const pid = r.channex_property_id as string;
    if (!sid || !pid) continue;
    const res = await listChannels(pid);
    const list = (res.data?.data ?? []).map((c) => ({
      channel: channelFromOta(c.attributes?.channel),
      title: c.attributes?.title || c.attributes?.channel || "Canale",
      active: c.attributes?.status === "active" || !!c.attributes?.is_active,
    }));
    byStructure[sid] = (byStructure[sid] ?? []).concat(list);
  }

  return NextResponse.json({ ok: true, byStructure });
}
