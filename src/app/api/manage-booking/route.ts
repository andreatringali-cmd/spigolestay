import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimited } from "@/lib/server-auth";
import { clientIp } from "@/lib/server-booking-guard";
import { findBookingStore, refundEligible, stripeRefundPlan, unrefundedOf } from "@/lib/manage-booking";
import { guestLangOrNull } from "@/lib/guest-lang";
import { bookingGrandTotal, type BookingLike } from "@/lib/booking";
import { balanceDue } from "@/lib/incassi";
import { ymdRome } from "@/lib/dates-rome";
import { plural } from "@/lib/plural";
import type { Structure } from "@/lib/types";

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
  if (rateLimited("mb:" + clientIp(req), 60, 60_000)) return NextResponse.json({ error: "troppe_richieste" }, { status: 429 });
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
    const bl = b as unknown as BookingLike & { paid?: number };
    const grandTotal = Math.round(bookingGrandTotal(bl, st as unknown as Structure) * 100) / 100;
    const balance = grandTotal > 0 ? balanceDue(bl, st as unknown as Structure) : 0;
    const plan = stripeRefundPlan(b);
    const canRefund = free && paid > 0 && (!!plan.main || plan.extras.length > 0);
    // Quanto si rimborsa in automatico = i pagamenti ONLINE (principale + saldi successivi), gli STESSI che l'annullamento rimborsa davvero:
    // il resto, incassato in altro modo, si concorda con la struttura.
    const refundAmount = canRefund ? plan.estimate : 0;
    const cancelPolicy = b.refundable
      ? (n(b.cancelDays) > 0 ? `Cancellazione gratuita fino a ${plural(n(b.cancelDays), "giorno", "giorni")} prima dell'arrivo.` : "Cancellazione gratuita.")
      : "Tariffa non rimborsabile.";

    return NextResponse.json({
      ok: true,
      booking: {
        code: s(b.code) || s(b.id).slice(0, 8).toUpperCase(),
        status,
        checkIn: s(b.checkIn), checkOut: s(b.checkOut),
        adults: n(b.adults) || 1, children: n(b.children),
        total: n(b.total), paid,
        // Totale ospite (soggiorno + pulizia + extra + tassa) e residuo: stesse funzioni del gestionale (lib/booking.ts, lib/incassi.ts).
        grandTotal, balance,
        // Annullabile da qui: prenotazione DIRETTA, non gia' annullata e con l'arrivo ancora da venire (stesse regole di /api/manage-booking/cancel).
        cancellable: status !== "cancelled" && s(b.channel) === "direct" && !!s(b.checkIn) && s(b.checkIn) > ymdRome(Date.now()),
        channel: s(b.channel) || "direct",
        roomType: s(rt.name),
        ratePlan: s(b.ratePlanName),
        refundable: b.refundable === true,
        cancelDays: n(b.cancelDays),
        cancelPolicy,
        free, freeUntil, canRefund, refundAmount,
        cancelledAt: s(b.cancelledAt) || null,
        refundedAmount: n(b.refundedAmount),
        // Pagato e non rimborsato su una prenotazione annullata: la pagina non deve scrivere "Nessun rimborso previsto" (la struttura contatta l'ospite).
        unrefunded: unrefundedOf(b),
        guestFirst: s(g.firstName) || s(g.fullName).split(" ")[0] || "",
        guestLang: guestLangOrNull({ language: s(g.language), lang: s(g.lang), country: s(g.country), phone: s(g.phone) }), // lingua della pagina (scheda → Paese → prefisso telefono)
      },
      structure: {
        name: s(st.name), color: s(st.photoColor), logo: s(st.logo),
        phone: s(st.phone), email: s(st.email),
        checkInFrom: s(st.checkInFrom), checkOutBy: s(st.checkOutBy),
        currency: s(st.currency) || "€",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
