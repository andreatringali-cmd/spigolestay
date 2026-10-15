import { NextResponse } from "next/server";
import { allowedChannexProperties, isCollaborator } from "@/lib/channex-guard";
import { requireUser, isErr } from "@/lib/server-auth";
import { channexEnabled, pushRestrictions, type RestrictionRow } from "@/lib/channex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prezzi dei piani "Per persona" (prezzo per 1 ospite). Volutamente SEPARATO da /api/channex/ari: un errore su questi piani non deve mai
// impedire l'invio dei prezzi normali agli altri portali. POST body: { restrictions: RestrictionRow[] }
export async function POST(req: Request) {
  const who = await requireUser(req);
  if (isErr(who)) return who;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });
  if (await isCollaborator(who.admin, who.userId)) return NextResponse.json({ ok: false, error: "solo_titolare" }, { status: 403 });
  const body = await req.json().catch(() => null) as null | { restrictions?: RestrictionRow[] };
  const restrictions = Array.isArray(body?.restrictions) ? body!.restrictions! : [];
  if (restrictions.length === 0) return NextResponse.json({ ok: true, sent: 0 });
  const mine = await allowedChannexProperties(who.admin, who.userId);
  if (restrictions.some((r) => !mine.has(String((r as { property_id?: string }).property_id || "")))) return NextResponse.json({ ok: false, error: "property_non_tua" }, { status: 403 });
  // a blocchi: un invio molto grande (500 giorni) non deve superare i limiti della richiesta
  let sent = 0;
  for (let i = 0; i < restrictions.length; i += 400) {
    const chunk = restrictions.slice(i, i + 400);
    const r = await pushRestrictions(chunk);
    if (!r.ok) return NextResponse.json({ ok: false, sent, error: (r as { error?: string }).error || `errore Channex (stato ${r.status})` }, { status: 200 });
    sent += chunk.length;
  }
  return NextResponse.json({ ok: true, sent });
}
