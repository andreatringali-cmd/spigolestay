import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { conciergeAnswer } from "@/lib/concierge-engine";
import { withOrgData } from "@/lib/concierge-orgdata";
import { AI_CONCIERGE_KEY, parseAiConciergePrefs } from "@/lib/aiConcierge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prova del Concierge dentro Xenora: stessa logica del WhatsApp automatico, senza inviare nulla a nessuno.
// Body: { structureId, bookingId?, message }  →  { ok, answered, reply?, topic?, reason?, hasBooking, lang }
export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  try {
    const b = await req.json().catch(() => ({}));
    const message = String(b?.message || "").trim().slice(0, 1000);
    const structureId = String(b?.structureId || "").trim();
    const bookingId = b?.bookingId ? String(b.bookingId) : undefined;
    if (!message) return NextResponse.json({ ok: false, error: "missing_message" }, { status: 400 });
    if (!structureId) return NextResponse.json({ ok: false, error: "missing_structure" }, { status: 400 });

    const { data: row } = await auth.admin.from("app_state").select("data").eq("user_id", auth.tenantId).maybeSingle();
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    let personal: Record<string, unknown> = {};
    try { personal = JSON.parse(blob["spigolestay:data:v1"] || "{}"); } catch { personal = {}; }
    // Strutture condivise (Structure.orgId): vivono in org_state, non nel blob personale. Sola lettura.
    const data = await withOrgData(auth.admin, auth.tenantId, personal);

    const bookings = (Array.isArray(data.bookings) ? data.bookings : []) as { id: string; guestId: string }[];
    const bk = bookingId ? bookings.find((x) => x.id === bookingId) : undefined;
    const guests = (Array.isArray(data.guests) ? data.guests : []) as { id: string; fullName?: string; language?: string }[];
    const g = bk ? guests.find((x) => x.id === bk.guestId) : undefined;

    const faqRaw: Record<string, string> = {};
    for (const k of Object.keys(blob)) if (k.startsWith("spigolestay:concierge")) faqRaw[k] = blob[k];

    const result = await conciergeAnswer({
      admin: auth.admin, tenantId: auth.tenantId,
      data: { structures: data.structures, bookings: data.bookings, units: data.units, roomTypes: data.roomTypes },
      roomAccessRaw: blob["spigolestay:roomaccess"], conciergeFaqRaw: faqRaw,
      structureId, bookingId, guest: g ? { id: g.id, language: g.language } : undefined, guestName: g?.fullName, message,
      tone: parseAiConciergePrefs(blob[AI_CONCIERGE_KEY]).tone, // la prova usa lo stesso tono scelto in Impostazioni

      assumeVerified: b?.verified !== false, // la prova la fa il proprietario: Wi-Fi e accesso si vedono come per un ospite in casa
    });
    console.log("[concierge]", JSON.stringify({ src: "prova", answered: result.answered, reason: result.reason, topic: result.topic, ms: result.ms })); // la prova NON finisce nell'elenco "senza risposta"
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "ask_failed", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
