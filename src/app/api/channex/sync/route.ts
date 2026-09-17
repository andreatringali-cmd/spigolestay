import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, createProperty, createRoomType, createRatePlan, type SyncProperty } from "@/lib/channex";
import { saveChannexMap } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sincronizza UNA struttura di Xenora verso Channex: crea property + room types + rate plan,
// e PERSISTE la mappatura Channex↔Xenora (channex_map) così il webhook/feed può importare
// le prenotazioni in entrata nel tenant giusto.
// POST /api/channex/sync (bearer) body: { structureId, structure:{...}, rooms:[{xid,title,count,occAdults,defaultOccupancy,rate}] }
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });
  const body = await req.json().catch(() => null) as null | {
    structureId?: string;
    structure?: { title?: string; currency?: string; country?: string; city?: string; address?: string; email?: string; phone?: string; latitude?: string; longitude?: string; logo_url?: string; website?: string };
    rooms?: { xid?: string; title: string; count: number; occAdults: number; occChildren?: number; defaultOccupancy?: number; rate?: number }[];
  };
  if (!body?.structure?.title) return NextResponse.json({ ok: false, error: "Dati struttura mancanti" }, { status: 400 });
  const structureId = String(body.structureId || "").trim();

  const prop = await createProperty(body.structure as SyncProperty);
  const propertyId = prop.data?.data?.id;
  if (!prop.ok || !propertyId) return NextResponse.json({ ok: false, step: "property", error: prop.error || "creazione property fallita" }, { status: 200 });

  const rooms: { xid?: string; title: string; ok: boolean; roomTypeId?: string; ratePlanId?: string; error?: string }[] = [];
  const roomMap: Record<string, string> = {}; // channex_room_type_id → xenora room_type xid
  for (const r of (body.rooms || [])) {
    const rt = await createRoomType(propertyId, r);
    const roomTypeId = rt.data?.data?.id;
    if (!rt.ok || !roomTypeId) { rooms.push({ xid: r.xid, title: r.title, ok: false, error: rt.error || "room type fallito" }); continue; }
    const rp = await createRatePlan(propertyId, roomTypeId, { occupancy: r.defaultOccupancy ?? r.occAdults, rate: r.rate ?? 0 });
    if (r.xid) roomMap[roomTypeId] = r.xid;
    rooms.push({ xid: r.xid, title: r.title, ok: true, roomTypeId, ratePlanId: rp.data?.data?.id, error: rp.ok ? undefined : rp.error });
  }

  // Persisti la mappatura server-side (indispensabile per l'import in entrata).
  if (structureId) await saveChannexMap(auth.admin, auth.tenantId, structureId, propertyId, roomMap);

  return NextResponse.json({ ok: true, propertyId, rooms });
}
