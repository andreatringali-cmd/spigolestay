import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, listProperties, listRoomTypesFor } from "@/lib/channex";
import { saveChannexMap } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_KEY = "spigolestay:data:v1";
const norm = (s?: string) => (s || "").trim().toLowerCase();

// Ricostruisce la mappatura Channex↔Xenora abbinando per NOME le property e le
// tipologie già presenti su Channex alle strutture/tipologie del tenant. Non crea
// nulla su Channex (nessun doppione): serve a "ricollegare" senza dipendere dal browser.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  // Strutture/tipologie del tenant dalla app_state.
  const { data: row } = await auth.admin.from("app_state").select("data").eq("user_id", auth.tenantId).maybeSingle();
  const blob = ((row?.data ?? {}) as Record<string, string>) || {};
  let data: Record<string, unknown> = {}; try { data = JSON.parse(blob[DATA_KEY] || "{}"); } catch { data = {}; }
  const structures = (Array.isArray(data.structures) ? data.structures : []) as { id: string; name?: string }[];
  const roomTypes = (Array.isArray(data.roomTypes) ? data.roomTypes : []) as { id: string; name?: string; structureId?: string }[];
  if (!structures.length) return NextResponse.json({ ok: false, error: "Nessuna struttura in Xenora." }, { status: 200 });

  const props = await listProperties();
  if (!props.ok) return NextResponse.json({ ok: false, error: props.error || "Errore lettura property Channex" }, { status: 200 });
  const propList = props.data?.data ?? [];

  const linked: { property: string; structure: string; structureId: string; propertyId: string; rooms: number; roomsMap: Record<string, string> }[] = [];
  const unmatched: string[] = [];
  for (const p of propList) {
    const title = norm(p.attributes?.title);
    const st = structures.find((s) => norm(s.name) === title);
    if (!st) { unmatched.push(p.attributes?.title || p.id); continue; }
    const rt = await listRoomTypesFor(p.id);
    const rooms: Record<string, string> = {}; // channex_room_type_id → xenora_room_type_id
    for (const cr of (rt.data?.data ?? [])) {
      const x = roomTypes.find((r) => r.structureId === st.id && norm(r.name) === norm(cr.attributes?.title));
      if (x) rooms[cr.id] = x.id;
    }
    await saveChannexMap(auth.admin, auth.tenantId, st.id, p.id, rooms);
    linked.push({ property: p.attributes?.title || p.id, structure: st.name || st.id, structureId: st.id, propertyId: p.id, rooms: Object.keys(rooms).length, roomsMap: rooms });
  }

  return NextResponse.json({ ok: true, linked, unmatched });
}
