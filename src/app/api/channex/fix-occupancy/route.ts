import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, updateRatePlanOccupancy, listRoomTypesFor, listRatePlansForRoomType } from "@/lib/channex";
import { allowedChannexMapRows, ratePlanBelongsTo } from "@/lib/channex-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Corregge l'occupazione di UN piano tariffario già creato su Channex. Serve quando una
// tipologia camera viene modificata in Xenora DOPO il collegamento (es. capienza sbagliata al
// primo sync): "Attiva distribuzione" non si può rilanciare (creerebbe un doppione), quindi
// questa route aggiorna il piano tariffario esistente senza ricrearlo.
// POST /api/channex/fix-occupancy (bearer) body: { ratePlanId, occupancy }
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });
  const body = await req.json().catch(() => null) as null | { ratePlanId?: string; occupancy?: number };
  const ratePlanId = String(body?.ratePlanId || "").trim();
  const occupancy = Number(body?.occupancy);
  if (!ratePlanId || !Number.isFinite(occupancy) || occupancy < 1) return NextResponse.json({ ok: false, error: "Parametri mancanti" }, { status: 400 });
  // Il piano tariffario deve appartenere a una property di QUESTO tenant (o di una sua struttura condivisa):
  // ratePlanId arriva dal client e l'account Channex è condiviso fra tutti.
  const owned = await ratePlanBelongsTo(ratePlanId, await allowedChannexMapRows(auth.admin, auth.tenantId), {
    listRoomTypeIds: async (pid) => ((await listRoomTypesFor(pid)).data?.data ?? []).map((r) => r.id),
    listRatePlanIds: async (rtId) => ((await listRatePlansForRoomType(rtId)).data?.data ?? []).map((r) => r.id),
  });
  if (!owned) return NextResponse.json({ ok: false, error: "Piano tariffario non trovato per questo account" }, { status: 404 });
  const res = await updateRatePlanOccupancy(ratePlanId, occupancy);
  return NextResponse.json({ ok: res.ok, status: res.status, error: res.ok ? undefined : res.error });
}
