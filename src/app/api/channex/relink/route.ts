import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, listProperties, listRoomTypesFor } from "@/lib/channex";
import { saveChannexMap } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_KEY = "spigolestay:data:v1";
const norm = (s?: string) => (s || "").trim().toLowerCase();

type Struct = { id: string; name?: string };
type RoomType = { id: string; name?: string; structureId?: string };
type Booking = { structureId?: string };
// Una struttura candidata all'abbinamento, con la sua origine (personale o org condivisa).
// `score` = quanto è "viva" (n. prenotazioni): per scegliere tra org duplicate.
interface Candidate { structureId: string; name: string; orgId: string | null; roomTypes: RoomType[]; score: number }

function parseBlob(data: unknown): { structures: Struct[]; roomTypes: RoomType[]; bookings: Booking[] } {
  const blob = ((data ?? {}) as Record<string, string>) || {};
  let d: Record<string, unknown> = {}; try { d = JSON.parse(blob[DATA_KEY] || "{}"); } catch { d = {}; }
  return {
    structures: (Array.isArray(d.structures) ? d.structures : []) as Struct[],
    roomTypes: (Array.isArray(d.roomTypes) ? d.roomTypes : []) as RoomType[],
    bookings: (Array.isArray(d.bookings) ? d.bookings : []) as Booking[],
  };
}
// Inserisce/aggiorna un candidato deduplicando per structureId: una org batte sempre
// il personale; tra due org (es. la "Spigolehouse" viva e il suo doppione orfano) vince
// quella con più prenotazioni.
function upsertCandidate(list: Candidate[], cand: Candidate) {
  const i = list.findIndex((c) => c.structureId === cand.structureId);
  if (i < 0) { list.push(cand); return; }
  const cur = list[i];
  const replace = cur.orgId === null ? cand.orgId !== null
    : cand.orgId !== null && cand.score > cur.score;
  if (replace) list[i] = cand;
}

// Ricostruisce la mappatura Channex↔Xenora abbinando per NOME le property e le
// tipologie già presenti su Channex alle strutture del tenant — sia quelle personali
// (app_state) sia quelle CONDIVISE (org_state delle sue membership). Non crea nulla su
// Channex (nessun doppione). Le prenotazioni in entrata andranno poi nello store giusto.
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const candidates: Candidate[] = [];

  // 1) Strutture PERSONALI del tenant.
  const { data: personal } = await auth.admin.from("app_state").select("data").eq("user_id", auth.tenantId).maybeSingle();
  {
    const { structures, roomTypes, bookings } = parseBlob(personal?.data);
    for (const s of structures) upsertCandidate(candidates, { structureId: s.id, name: s.name || "", orgId: null, roomTypes: roomTypes.filter((rt) => rt.structureId === s.id), score: bookings.filter((b) => b.structureId === s.id).length });
  }

  // 2) Strutture CONDIVISE: org di cui il tenant è membro/owner.
  const { data: mships } = await auth.admin.from("memberships").select("org_id").eq("user_id", auth.tenantId);
  const orgIds = Array.from(new Set((mships ?? []).map((m) => m.org_id as string).filter(Boolean)));
  for (const oid of orgIds) {
    const { data: os } = await auth.admin.from("org_state").select("data").eq("org_id", oid).maybeSingle();
    const { structures, roomTypes, bookings } = parseBlob(os?.data);
    for (const s of structures) upsertCandidate(candidates, { structureId: s.id, name: s.name || "", orgId: oid, roomTypes: roomTypes.filter((rt) => rt.structureId === s.id), score: bookings.filter((b) => b.structureId === s.id).length });
  }

  if (!candidates.length) return NextResponse.json({ ok: false, error: "Nessuna struttura in Xenora (né personale né condivisa)." }, { status: 200 });

  const props = await listProperties();
  if (!props.ok) return NextResponse.json({ ok: false, error: props.error || "Errore lettura property Channex" }, { status: 200 });
  const propList = props.data?.data ?? [];

  // Per ogni property Channex trova la struttura per nome e le camere abbinate. Se PIÙ property
  // combaciano con la stessa struttura (doppioni su Channex), tengo solo la più COMPLETA
  // (più camere abbinate) per non creare mappature doppie.
  type Match = { c: Candidate; propertyId: string; propertyTitle: string; rooms: Record<string, string>; count: number };
  const bestByStruct = new Map<string, Match>();
  const unmatched: string[] = [];
  for (const p of propList) {
    const title = norm(p.attributes?.title);
    const c = candidates.find((x) => norm(x.name) === title);
    if (!c) { unmatched.push(p.attributes?.title || p.id); continue; }
    const rt = await listRoomTypesFor(p.id);
    const rooms: Record<string, string> = {}; // channex_room_type_id → xenora_room_type_id
    for (const cr of (rt.data?.data ?? [])) {
      const x = c.roomTypes.find((r) => norm(r.name) === norm(cr.attributes?.title));
      if (x) rooms[cr.id] = x.id;
    }
    const count = Object.keys(rooms).length;
    const cur = bestByStruct.get(c.structureId);
    if (!cur || count > cur.count) bestByStruct.set(c.structureId, { c, propertyId: p.id, propertyTitle: p.attributes?.title || p.id, rooms, count });
  }

  const linked: { property: string; structure: string; structureId: string; propertyId: string; orgId: string | null; rooms: number; roomsMap: Record<string, string> }[] = [];
  for (const [sid, m] of bestByStruct) {
    await saveChannexMap(auth.admin, auth.tenantId, sid, m.propertyId, m.rooms, m.c.orgId);
    // Auto-pulizia doppioni: rimuovi altre mappature per la STESSA struttura che puntano a
    // una property Channex diversa da quella scelta.
    let del = auth.admin.from("channex_map").delete().eq("structure_id", sid).neq("channex_property_id", m.propertyId);
    del = m.c.orgId ? del.eq("org_id", m.c.orgId) : del.eq("tenant_id", auth.tenantId).is("org_id", null);
    await del;
    linked.push({ property: m.propertyTitle, structure: m.c.name || sid, structureId: sid, propertyId: m.propertyId, orgId: m.c.orgId, rooms: m.count, roomsMap: m.rooms });
  }

  return NextResponse.json({ ok: true, linked, unmatched });
}
