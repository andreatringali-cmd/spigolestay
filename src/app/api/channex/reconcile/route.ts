import { NextResponse } from "next/server";
import { requireUser, isErr, rateLimited } from "@/lib/server-auth";
import { allowedChannexProperties, isCollaborator } from "@/lib/channex-guard";
import { channexEnabled, getLatestRevisionOfBooking } from "@/lib/channex";
import { reconcileBookings } from "@/lib/channex-reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cifre ESATTE (totale con i centesimi, commissione, costo d'incasso) di prenotazioni Booking già importate, rilette dalla revision attuale di Channex.
// SOLA LETTURA: non scrive nulla e non fa ack; le patch le applica il browser (BookingHealer) in silenzio.
// POST /api/channex/reconcile  body: { ids: string[] }  (id Channex = extId senza "channex:"; al massimo 8 per chiamata, il resto va in `skipped`)
// Risposta: { ok, results: [{ id, ok, status, total, commissionAmount, paymentFee, rooms[], error? }], skipped[], stopped? }
// Gli errori per singola prenotazione stanno in results[].error (mai in `error` di primo livello, riservato agli errori della richiesta).
export async function POST(req: Request) {
  const who = await requireUser(req);
  if (isErr(who)) return who;
  if (!channexEnabled()) return NextResponse.json({ ok: false, results: [], skipped: [], stopped: "non_configurato" });
  // I collaboratori non lanciano allineamenti: lo fa il titolare.
  if (await isCollaborator(who.admin, who.userId)) return NextResponse.json({ ok: false, error: "solo_titolare" }, { status: 403 });
  if (rateLimited(`chx-reconcile:${who.userId}`, 30, 10 * 60 * 1000)) return NextResponse.json({ ok: false, error: "troppe_richieste" }, { status: 429 });
  const body = await req.json().catch(() => null) as null | { ids?: unknown };
  const ids = Array.isArray(body?.ids) ? (body!.ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids_mancanti" }, { status: 400 });

  const allowedProps = await allowedChannexProperties(who.admin, who.userId);
  const out = await reconcileBookings(ids, { fetchLatest: getLatestRevisionOfBooking, allowedProps, now: () => Date.now() });
  return NextResponse.json({ ok: true, ...out });
}
