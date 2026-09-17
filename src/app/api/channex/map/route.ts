import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { saveChannexMap } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allinea la mappatura Channex↔Xenora SENZA ricreare la property (per le strutture
// già sincronizzate quando la mappa stava solo nel browser). Idempotente.
// POST /api/channex/map (bearer) body: { structureId, propertyId, rooms: { channexRoomTypeId: xenoraRoomTypeId } }
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const b = await req.json().catch(() => ({}));
  const structureId = String(b?.structureId || "").trim();
  const propertyId = String(b?.propertyId || "").trim();
  const rooms = (b?.rooms && typeof b.rooms === "object") ? b.rooms as Record<string, string> : {};
  if (!structureId || !propertyId) return NextResponse.json({ error: "missing_params" }, { status: 400 });
  const res = await saveChannexMap(auth.admin, auth.tenantId, structureId, propertyId, rooms);
  return NextResponse.json({ ok: res.ok, error: res.error });
}
