// Rete di passaggio Xenora TRA ACCOUNT DIVERSI (V2 di findAvailableSibling in
// src/lib/publicdata.ts, che resta invariata per il caso "stesso proprietario").
//
// Un ospite su UNA struttura Xenora (Xenosite pubblico) non trova disponibilità
// per le date scelte. Se quella struttura ha attivato `networkOptIn` (opt-in
// esplicito, default OFF), cerchiamo tra le ALTRE strutture pubblicate che:
//   1) hanno anch'esse attivato `networkOptIn` (opt-in reciproco: nessuna
//      struttura compare nei suggerimenti altrui senza averlo scelto);
//   2) sono nella stessa città (v1 volutamente semplice: niente geo-distanza,
//      poche decine di account non la giustificano);
//   3) hanno davvero una camera libera e capiente per quelle date/ospiti.
//
// Privacy by design: questa route gira con la service role e legge gli stessi
// snapshot SANIFICATI già pubblicati su `public_sites` (nessun ospite, nessun
// prezzo, nessun dato fiscale — vedi buildPublishData in src/lib/publicdata.ts).
// Al chiamante (il browser dell'ospite) restituiamo SOLO slug, nome e città/zona
// delle strutture risultate libere: mai i blob completi letti internamente.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { RESERVED_SLUGS } from "@/lib/publicdata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_KEY = "spigolestay:data:v1";
const MAX_RESULTS = 3;

interface StructRow { id?: string; name?: string; city?: string; zone?: string; networkOptIn?: boolean }
interface RoomTypeRow { id: string; deriveFrom?: string; salesClosed?: boolean; maxOccupancy?: number; beds?: number }
interface UnitRow { id: string; roomTypeId: string; outOfService?: boolean }
interface BookingRow { unitId?: string | null; status?: string; channel?: string; checkIn: string; checkOut: string }
interface Blob {
  structures?: StructRow[];
  roomTypes?: RoomTypeRow[];
  units?: UnitRow[];
  bookings?: BookingRow[];
}

const isISO = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Stessa logica di siblingRootId in src/lib/publicdata.ts: le tariffe derivate
// condividono le camere fisiche della tipologia "madre", quindi la disponibilità
// va verificata sulla radice della catena di derivazione.
function rootId(rt: RoomTypeRow, all: RoomTypeRow[]): string {
  let cur = rt;
  const seen = new Set<string>();
  while (cur.deriveFrom && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = all.find((x) => x.id === cur.deriveFrom);
    if (!parent) break;
    cur = parent;
  }
  return cur.id;
}

export async function GET(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!sbUrl || !key) return NextResponse.json({ suggestions: [] }, { status: 503 });

  const url = new URL(req.url);
  const excludeSlug = (url.searchParams.get("slug") || "").trim().toLowerCase();
  const city = (url.searchParams.get("city") || "").trim().toLowerCase();
  const ci = (url.searchParams.get("ci") || "").trim();
  const co = (url.searchParams.get("co") || "").trim();
  const guests = Math.max(1, parseInt(url.searchParams.get("guests") || "1", 10) || 1);

  if (!city || !isISO(ci) || !isISO(co) || co <= ci) return NextResponse.json({ suggestions: [] });

  type Row = { slug: string | null; structure_id: string | null; structure_name: string | null; data: Record<string, string> | null };
  try {
    const db = createClient(sbUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from("public_sites").select("slug, structure_id, structure_name, data");
    if (error || !data) return NextResponse.json({ suggestions: [] });

    const out: { slug: string; name: string; city?: string; zone?: string }[] = [];
    for (const row of data as Row[]) {
      const slug = (row.slug || "").trim().toLowerCase();
      if (!slug || slug === excludeSlug || RESERVED_SLUGS.has(slug) || !row.data) continue;

      let blob: Blob = {};
      try { blob = JSON.parse(row.data[DATA_KEY] || "{}") as Blob; } catch { continue; }

      const structs = Array.isArray(blob.structures) ? blob.structures : [];
      const structure = structs.find((s) => s.id === row.structure_id) || structs[0];
      // Opt-in esplicito richiesto sulla struttura candidata: senza, non entra mai
      // nei suggerimenti di un altro account, a prescindere dalla città.
      if (!structure || structure.networkOptIn !== true) continue;

      const structCity = (structure.city || "").trim().toLowerCase();
      if (!structCity || structCity !== city) continue;

      const roomTypes = Array.isArray(blob.roomTypes) ? blob.roomTypes : [];
      const units = Array.isArray(blob.units) ? blob.units : [];
      const bookings = Array.isArray(blob.bookings) ? blob.bookings : [];
      const hasFree = roomTypes.some((rt) => {
        if (rt.salesClosed) return false;
        if ((rt.maxOccupancy ?? rt.beds ?? 0) < guests) return false;
        const rid = rootId(rt, roomTypes);
        return units.some((u) =>
          u.roomTypeId === rid &&
          !u.outOfService &&
          !bookings.some((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.unitId === u.id && b.checkIn < co && b.checkOut > ci)
        );
      });
      if (!hasFree) continue;

      out.push({
        slug,
        name: structure.name?.trim() || row.structure_name?.trim() || slug,
        city: structure.city,
        zone: structure.zone,
      });
      if (out.length >= MAX_RESULTS) break;
    }

    return NextResponse.json({ suggestions: out });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
