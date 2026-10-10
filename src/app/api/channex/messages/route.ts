import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { listBookingMessages, sendBookingMessage, sendBookingAttachment, channexBase } from "@/lib/channex";
import { parseAttachments } from "@/lib/channex-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chat Booking.com/Airbnb/Expedia via Channex — action "list" | "send".
// bookingId = id PRENOTAZIONE Channex (il client lo estrae da extId togliendo "channex:").
// SPERIMENTALE: la Messages App di Channex va installata per property nella sua dashboard;
// senza, "send"/"list" rispondono errore e lo mostriamo così com'è (niente invii silenziosi falliti).
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const b = await req.json().catch(() => ({}));
  const action = String(b?.action || "list").trim();
  const bookingId = String(b?.bookingId || "").trim();
  if (!bookingId) return NextResponse.json({ error: "missing_bookingId" }, { status: 400 });

  // Autorizzazione: la prenotazione deve risultare importata per questo tenant (o la sua org
  // condivisa) in channex_bookings — evita che un tenant legga/scriva la chat di un altro.
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

  // Allegato (foto/PDF) dalla chat: il client manda il file in base64 (max ~3 MB per stare nel limite di body di Vercel). Non viene salvato da noi.
  if (action === "send_attachment") {
    const base64 = String(b?.base64 || "").replace(/^data:[^,]*,/, "");
    const name = String(b?.name || "").trim().slice(0, 120) || "allegato";
    const type = String(b?.type || "").trim();
    if (!base64) return NextResponse.json({ error: "missing_file" }, { status: 400 });
    if (!/^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(type)) return NextResponse.json({ ok: false, error: "Formato non supportato: solo immagini (JPG, PNG, WebP, GIF) e PDF." });
    if (base64.length > 4_200_000) return NextResponse.json({ ok: false, error: "File troppo grande (massimo circa 3 MB)." });
    const res = await sendBookingAttachment(bookingId, { base64, name, type });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || `errore Channex (status ${res.status})` });
    return NextResponse.json({ ok: true });
  }
  if (action === "send") {
    const text = String(b?.text || "").trim();
    if (!text) return NextResponse.json({ error: "missing_text" }, { status: 400 });
    const res = await sendBookingMessage(bookingId, text);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || `errore Channex (status ${res.status})` });
    return NextResponse.json({ ok: true });
  }
  const res = await listBookingMessages(bookingId);
  // `att`: allegati con URL già completo (Channex può darli relativi e temporanei: si rileggono a ogni apertura della chat).
  const messages = res.messages.map((m) => ({ ...m, att: parseAttachments(m.attachments, channexBase()) }));
  return NextResponse.json({ ok: res.ok, error: res.ok ? undefined : res.error, messages });
}
