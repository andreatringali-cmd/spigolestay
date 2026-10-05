import { NextResponse } from "next/server";
import { allowedChannexProperties } from "@/lib/channex-guard";
import { requireUser, isErr } from "@/lib/server-auth";
import { channexEnabled, pushAvailability, pushRestrictions, type AvailValue, type RestrictionRow } from "@/lib/channex";

// Aggiorna disponibilità, prezzi e restrizioni su Channex (poi Channex li spinge alle OTA).
// POST /api/channex/ari  body: { availability: AvailValue[], restrictions: RestrictionRow[] }
// Retrocompatibilità: se arriva ancora `rates`, lo trattiamo come `restrictions`
// (prezzi e restrizioni condividono lo stesso endpoint /restrictions su Channex).
export async function POST(req: Request) {
  const who = await requireUser(req);
  if (isErr(who)) return who;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });
  const body = await req.json().catch(() => null) as null | { availability?: AvailValue[]; restrictions?: RestrictionRow[]; rates?: RestrictionRow[] };
  const availability = body?.availability ?? [];
  const restrictions = body?.restrictions ?? body?.rates ?? [];
  if (availability.length === 0 && restrictions.length === 0) return NextResponse.json({ ok: false, error: "Nessun dato da inviare" }, { status: 400 });
  // Si possono aggiornare solo le proprie property: prima chiunque poteva azzerare o gonfiare disponibilità e prezzi di un altro hotel.
  const mine = await allowedChannexProperties(who.admin, who.userId);
  const foreign = [...availability, ...restrictions].some((r) => !mine.has(String((r as { property_id?: string }).property_id || "")));
  if (foreign) return NextResponse.json({ ok: false, error: "property_non_tua" }, { status: 403 });

  // Due chiamate Channex distinte (endpoint diversi): la disponibilità su /availability,
  // prezzi+restrizioni su /restrictions. Ognuna riporta il proprio esito così il client
  // può aggiornare lo snapshot delta SOLO per la parte inviata con successo.
  const av = availability.length ? await pushAvailability(availability) : { ok: true, status: 200 };
  const rt = restrictions.length ? await pushRestrictions(restrictions) : { ok: true, status: 200 };

  const ok = av.ok && rt.ok;
  return NextResponse.json({
    ok,
    availability: { ok: av.ok, sent: availability.length, error: av.ok ? undefined : (av as { error?: string }).error },
    restrictions: { ok: rt.ok, sent: restrictions.length, error: rt.ok ? undefined : (rt as { error?: string }).error },
  }, { status: 200 });
}
