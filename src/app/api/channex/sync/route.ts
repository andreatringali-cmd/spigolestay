import { NextResponse } from "next/server";
import { channexEnabled, createProperty, createRoomType, createRatePlan, type SyncProperty } from "@/lib/channex";

// Sincronizza UNA struttura di Xenora verso Channex: crea property + room types + rate plan.
// Il client invia i dati (già inseriti in Xenora); qui NON si ridigita nulla, si ricopia.
// POST /api/channex/sync  body: { structure:{...}, rooms:[{title,count,occAdults,defaultOccupancy,rate}] }
export async function POST(req: Request) {
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });
  const body = await req.json().catch(() => null) as null | {
    structure?: { title?: string; currency?: string; country?: string; city?: string; address?: string; email?: string; phone?: string; latitude?: string; longitude?: string; logo_url?: string; website?: string };
    rooms?: { title: string; count: number; occAdults: number; occChildren?: number; defaultOccupancy?: number; rate?: number }[];
  };
  if (!body?.structure?.title) return NextResponse.json({ ok: false, error: "Dati struttura mancanti" }, { status: 400 });

  const prop = await createProperty(body.structure as SyncProperty);
  const propertyId = prop.data?.data?.id;
  if (!prop.ok || !propertyId) return NextResponse.json({ ok: false, step: "property", error: prop.error || "creazione property fallita" }, { status: 200 });

  const rooms: { title: string; ok: boolean; roomTypeId?: string; ratePlanId?: string; error?: string }[] = [];
  for (const r of (body.rooms || [])) {
    const rt = await createRoomType(propertyId, r);
    const roomTypeId = rt.data?.data?.id;
    if (!rt.ok || !roomTypeId) { rooms.push({ title: r.title, ok: false, error: rt.error || "room type fallito" }); continue; }
    const rp = await createRatePlan(propertyId, roomTypeId, { occupancy: r.defaultOccupancy ?? r.occAdults, rate: r.rate ?? 0 });
    rooms.push({ title: r.title, ok: true, roomTypeId, ratePlanId: rp.data?.data?.id, error: rp.ok ? undefined : rp.error });
  }

  return NextResponse.json({ ok: true, propertyId, rooms });
}
