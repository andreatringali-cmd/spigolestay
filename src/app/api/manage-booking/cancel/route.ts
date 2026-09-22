import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findBookingStore, refundEligible, writeBookingPatch } from "@/lib/manage-booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);

// Annullamento della prenotazione da parte dell'OSPITE (pagina /gestisci).
// Se la tariffa è rimborsabile e siamo entro la finestra gratuita e c'è un pagamento
// online, emette il RIMBORSO automatico su Stripe (conto connesso della struttura),
// poi marca la prenotazione come annullata e invia le email (ospite + gestore).
export async function POST(req: Request) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!sbUrl || !service) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim();
    const bid = String(body?.b || "").trim();
    if (!slug || !bid) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });

    const admin = createClient(sbUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const store = await findBookingStore(admin, slug, bid);
    if (!store) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const b = store.booking as Json;
    const st = (store.structure ?? {}) as Json;
    const g = (store.guest ?? {}) as Json;

    // Idempotenza: già annullata → riporta l'esito precedente.
    if (s(b.status) === "cancelled") {
      return NextResponse.json({ ok: true, already: true, refunded: n(b.refundedAmount) });
    }

    const now = new Date().toISOString();
    const { free, freeUntil } = refundEligible(b, now);
    const paid = n(b.paid);
    const pi = s(b.stripePaymentIntent);
    const acct = s(b.stripeAccountId);

    // Rimborso automatico se: entro finestra gratuita + pagamento online presente + Stripe ok.
    let refunded = 0;
    let refundError = "";
    if (free && paid > 0 && pi && acct && key) {
      try {
        const stripe = new Stripe(key);
        const r = await stripe.refunds.create({ payment_intent: pi, refund_application_fee: true }, { stripeAccount: acct });
        // amount è in centesimi; se non fornito rimborsa l'intero pagamento.
        refunded = typeof r.amount === "number" ? Math.round(r.amount) / 100 : paid;
      } catch (e) {
        refundError = e instanceof Error ? e.message : "refund_error";
      }
    }

    // Marca annullata (rev-locked). Manteniamo lo storico: status=cancelled + metadati.
    const wrote = await writeBookingPatch(admin, store, {
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: "guest",
      updatedAt: Date.now(),
      refundedAmount: refunded || undefined,
      note: [s(b.note), `Annullata dall'ospite il ${now.slice(0, 10)}${refunded > 0 ? ` — rimborso €${refunded}` : ""}`].filter(Boolean).join(" · "),
    });
    if (!wrote) return NextResponse.json({ ok: false, error: "write_conflict" }, { status: 409 });

    // Email all'ospite (best-effort) + notifica al gestore.
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const cancelPolicy = b.refundable
      ? (n(b.cancelDays) > 0 ? `Cancellazione gratuita fino a ${n(b.cancelDays)} giorni prima.` : "Cancellazione gratuita.")
      : "Tariffa non rimborsabile.";
    const gEmail = s(g.email);
    const code = s(b.code) || s(b.id).slice(0, 8).toUpperCase();
    const currency = s(st.currency) || "€";
    try {
      if (gEmail) {
        await fetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "cancel",
            booking: {
              code, structureName: s(st.name), structureEmail: s(st.email), color: s(st.photoColor),
              guestName: `${s(g.firstName)} ${s(g.lastName)}`.trim() || s(g.fullName) || gEmail, guestEmail: gEmail,
              checkIn: s(b.checkIn), checkOut: s(b.checkOut), currency,
              refunded, cancelPolicy: refunded > 0 ? undefined : cancelPolicy,
            },
          }),
        });
      }
      // Notifica al gestore (usa il kind "quote" = testo semplice verso la struttura).
      const hostEmail = s(st.email);
      if (hostEmail) {
        await fetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "quote", to: hostEmail, subject: `Annullamento ${code} · ${s(st.name)}`,
            accent: "#b4472e",
            text: `L'ospite ha annullato la prenotazione ${code}.\n\nStruttura: ${s(st.name)}\nPeriodo: ${s(b.checkIn)} → ${s(b.checkOut)}\nOspite: ${`${s(g.firstName)} ${s(g.lastName)}`.trim() || gEmail}\n\nRimborso emesso: ${refunded > 0 ? `${currency} ${refunded}` : "nessuno"}${refundError ? `\n\n⚠ Errore nel rimborso automatico: ${refundError} — verifica su Stripe.` : ""}`,
          }),
        });
      }
    } catch { /* email non critica */ }

    return NextResponse.json({ ok: true, refunded, free, freeUntil, refundError: refundError || undefined });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
