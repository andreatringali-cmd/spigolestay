import { NextResponse } from "next/server";
import { requireUser, isErr } from "@/lib/server-auth";
import { allowedChannexProperties, isCollaborator } from "@/lib/channex-guard";
import { channexEnabled, createExtraRatePlan, listRatePlansForRoomType } from "@/lib/channex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crea (una sola volta) su Channex un piano tariffario "Per persona" per UNA tipologia, con le occupazioni 1 e 2 persone,
// così un portale che accetta prezzi per persona (es. bed-and-breakfast.it) può avere un prezzo diverso per l'uso singola.
// NON tocca il piano base né i canali già collegati: il piano nuovo non è collegato a nessun portale finché l'owner non lo
// sceglie nella mappatura di quel canale su Channex. Idempotente: se esiste già un piano con lo stesso titolo lo restituisce.
// POST /api/channex/person-plan { structureId, roomTypeId, baseRate, mode: "pct"|"eur", value, title? }
export async function POST(req: Request) {
  const who = await requireUser(req);
  if (isErr(who)) return who;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });
  if (await isCollaborator(who.admin, who.userId)) return NextResponse.json({ ok: false, error: "solo_titolare" }, { status: 403 });

  const b = await req.json().catch(() => null) as { structureId?: string; roomTypeId?: string; baseRate?: number; mode?: string; value?: number; title?: string } | null;
  const structureId = String(b?.structureId || "").trim();
  const roomTypeId = String(b?.roomTypeId || "").trim();
  const baseRate = Number(b?.baseRate);
  const value = Number(b?.value);
  const mode = b?.mode === "eur" ? "eur" : "pct";
  const title = (String(b?.title || "Per persona").trim() || "Per persona").slice(0, 60);
  if (!structureId || !roomTypeId || !Number.isFinite(baseRate) || baseRate <= 0 || !Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ ok: false, error: "Dati mancanti: struttura, camera, prezzo base e sconto per 1 ospite." }, { status: 400 });
  }
  if (mode === "pct" && value >= 100) return NextResponse.json({ ok: false, error: "Lo sconto in % deve essere sotto il 100." }, { status: 400 });

  // La struttura deve risultare collegata a una property Channex di chi sta chiamando.
  const mine = await allowedChannexProperties(who.admin, who.userId);
  const { data: rows } = await who.admin.from("channex_map").select("channex_property_id, rooms").eq("structure_id", structureId);
  const row = (rows ?? []).find((r) => r.channex_property_id && mine.has(String(r.channex_property_id)));
  if (!row) return NextResponse.json({ ok: false, error: "Struttura non collegata a Channex (o non tua)." }, { status: 200 });
  const propertyId = String(row.channex_property_id);
  // rooms: id tipologia Channex → id tipologia Xenora
  const chxRoom = Object.entries((row.rooms ?? {}) as Record<string, string>).find(([, xid]) => xid === roomTypeId)?.[0];
  if (!chxRoom) return NextResponse.json({ ok: false, error: "Questa camera non è collegata a una tipologia Channex." }, { status: 200 });

  // Già creato in passato → si riusa (niente doppioni).
  const existing = await listRatePlansForRoomType(chxRoom);
  const found = (existing.data?.data ?? []).find((p) => (p.attributes?.title || "").trim().toLowerCase() === title.toLowerCase());
  if (found?.id) return NextResponse.json({ ok: true, ratePlanId: found.id, created: false });

  const res = await createExtraRatePlan(propertyId, chxRoom, { title, baseRate, plan: { adjPct: 0, adjEur: 0 }, single: { mode, value }, occupancy: 2 });
  const id = res.data?.data?.id;
  if (!res.ok || !id) return NextResponse.json({ ok: false, error: res.error || `Channex non ha creato il piano (stato ${res.status})` }, { status: 200 });
  return NextResponse.json({ ok: true, ratePlanId: id, created: true });
}
