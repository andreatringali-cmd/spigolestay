import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { upsertGcalEvent, deleteGcalEvent, gcalEventId, verifyGcalAccess } from "@/lib/googleCalendarSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scrive/cancella UN evento sul calendario Google reale del tenant, chiamata dal client
// (store.tsx) dopo ogni creazione/modifica/cancellazione di prenotazione — fire-and-forget,
// non blocca né fa fallire l'operazione locale se Google non risponde (vedi chiamante).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const body = await req.json().catch(() => ({}));
  const { action, bookingId, calendarId } = body as { action?: string; bookingId?: string; calendarId?: string };
  if (!calendarId || typeof calendarId !== "string") return NextResponse.json({ ok: false, error: "missing_calendar_id" }, { status: 400 });

  // Verifica sola lettura (nessun evento coinvolto): per dare un riscontro immediato quando si
  // incolla l'ID calendario in Impostazioni, prima ancora di salvare o sincronizzare davvero.
  if (action === "verify") return NextResponse.json(await verifyGcalAccess(calendarId));

  if (!bookingId || typeof bookingId !== "string") return NextResponse.json({ ok: false, error: "missing_booking_id" }, { status: 400 });
  const eventId = gcalEventId(bookingId);

  if (action === "delete") {
    const res = await deleteGcalEvent(calendarId, eventId);
    return NextResponse.json(res);
  }
  if (action === "upsert") {
    const { summary, description, startDate, endDateExclusive } = body as { summary?: string; description?: string; startDate?: string; endDateExclusive?: string };
    if (!summary || !startDate || !endDateExclusive) return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    const res = await upsertGcalEvent({ calendarId, eventId, summary, description, startDate, endDateExclusive });
    return NextResponse.json(res);
  }
  return NextResponse.json({ ok: false, error: "bad_action" }, { status: 400 });
}
