import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findBookingStore, refundEligible } from "@/lib/manage-booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);

// Info prenotazione per la pagina pubblica /gestisci (dati sanificati: niente documenti,
// niente altre prenotazioni, solo ciò che serve all'ospite per gestire la SUA).
export async function GET(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !service) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  try {
    const u = new URL(req.url);
    const slug = (u.searchParams.get("slug") || "").trim();
    const bid = (u.searchParams.get("b") || "").trim();
    if (!slug || !bid) return NextResponse.json({ error: "missing_params" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const store = await findBookingStore(admin, slug, bid);
    if (!store) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const b = store.booking as Json;
    const st = (store.structure ?? {}) as Json;
    const rt = (store.roomType ?? {}) as Json;
    const g = (store.guest ?? {}) as Json;
    const status = s(b.status) || "confirmed";
    const now = new Date().toISOString();
    const { free, freeUntil } = refundEligible(b, now);
    const paid = n(b.paid);
    const canRefund = free && paid > 0 && !!s(b.stripePaymentIntent);
    const cancelPolicy = b.refundable
      ? (n(b.cancelDays) > 0 ? `Cancellazione gratuita fino a ${n(b.cancelDays)} giorni prima dell'arrivo.` : "Cancellazione gratuita.")
      : "Tariffa non rimborsabile.";

    return NextResponse.json({
      ok: true,
      booking: {
        code: s(b.code) || s(b.id).slice(0, 8).toUpperCase(),
        status,
        checkIn: s(b.checkIn), checkOut: s(b.checkOut),
        adults: n(b.adults) || 1, children: n(b.children),
        total: n(b.total), paid,
        roomType: s(rt.name),
        ratePlan: s(b.ratePlanName),
        refundable: b.refundable === true,
        cancelDays: n(b.cancelDays),
        cancelPolicy,
        free, freeUntil, canRefund,
        cancelledAt: s(b.cancelledAt) || null,
        refundedAmount: n(b.refundedAmount),
        guestFirst: s(g.firstName) || s(g.fullName).split(" ")[0] || "",
      },
      structure: {
        name: s(st.name), color: s(st.photoColor),
        phone: s(st.phone), email: s(st.email),
        checkInFrom: s(st.checkInFrom), checkOutBy: s(st.checkOutBy),
        currency: s(st.currency) || "€",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
