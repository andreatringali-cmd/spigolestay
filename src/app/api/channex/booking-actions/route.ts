import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { reportBookingToOta } from "@/lib/channex";
import { parseOtaActionInput } from "@/lib/channex-booking-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Segnalazioni all'OTA via Channex (SOLO Booking.com): no-show, carta non valida, annullo per
// carta non valida. ALTO RISCHIO (effetti reali su ospite e commissioni): la route è raggiungibile
// solo con utente autenticato + prenotazione di sua proprietà + parola di conferma esatta nel
// corpo. NON deve mai essere chiamata da cron, webhook o automazioni.
// Body: { bookingId (id Channex, senza "channex:"), action, confirm }
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const parsed = parseOtaActionInput(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { bookingId, action } = parsed.value;

  // Autorizzazione (come /api/channex/messages): la prenotazione deve risultare importata per
  // questo tenant, o per un'org condivisa di cui è membro, in channex_bookings.
  const { data: cb } = await auth.admin.from("channex_bookings").select("channex_property_id, tenant_id").eq("booking_id", bookingId).maybeSingle();
  if (!cb) return NextResponse.json({ error: "prenotazione_non_trovata" }, { status: 404 });
  let ok = cb.tenant_id === auth.tenantId;
  if (!ok && cb.channex_property_id) {
    const { data: map } = await auth.admin.from("channex_map").select("org_id").eq("channex_property_id", cb.channex_property_id).maybeSingle();
    if (map?.org_id) {
      const { data: m } = await auth.admin.from("memberships").select("org_id").eq("user_id", auth.tenantId).eq("org_id", map.org_id).maybeSingle();
      ok = !!m;
    }
  }
  if (!ok) return NextResponse.json({ error: "non_autorizzato" }, { status: 403 });

  const res = await reportBookingToOta(action, bookingId);
  if (!res.ok) {
    // 422 method_not_supported = canale non supportato, oppure fuori finestra/stato non modificabile.
    const hint = res.status === 422 ? "Channex ha rifiutato la richiesta (canale non supportato, fuori finestra temporale o prenotazione non modificabile)." : undefined;
    return NextResponse.json({ ok: false, status: res.status, error: res.error || `errore Channex (status ${res.status})`, hint });
  }
  return NextResponse.json({ ok: true, message: res.data?.meta?.message || "Success" });
}
