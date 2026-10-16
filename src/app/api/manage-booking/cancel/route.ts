import Stripe from "stripe";
import { siteOrigin } from "@/lib/server-auth";
import { internalFetch } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimited } from "@/lib/server-auth";
import { clientIp } from "@/lib/server-booking-guard";
import { findBookingStore, refundEligible, writeBookingPatch } from "@/lib/manage-booking";
import { fmtDMY } from "@/lib/dates";
import { ymdRome } from "@/lib/dates-rome";

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
    if (rateLimited("mbc:" + clientIp(req), 20, 60_000)) return NextResponse.json({ ok: false, error: "troppe_richieste" }, { status: 429 });

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

    // L'ospite può annullare da solo solo prenotazioni DIRETTE e SOLO prima dell'arrivo (data di Roma):
    // un soggiorno iniziato o finito non si annulla da un link (sparirebbe da incassi, report e ISTAT).
    if (s(b.channel) !== "direct") {
      return NextResponse.json({ ok: false, error: "not_cancellable", message: "Questa prenotazione non può essere annullata da qui: contatta la struttura." }, { status: 403 });
    }
    const ciDate = s(b.checkIn);
    if (!ciDate || ciDate <= ymdRome(Date.now())) {
      return NextResponse.json({ ok: false, error: "stay_started", message: "Il soggiorno è già iniziato o concluso: contatta la struttura." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const { free, freeUntil } = refundEligible(b, now);
    const paid = n(b.paid);
    const pi = s(b.stripePaymentIntent);

    // Rimborso automatico se: entro finestra gratuita + pagamento online presente + Stripe ok.
    // Il pagamento è una DESTINATION CHARGE sulla piattaforma: il rimborso si crea sull'account
    // piattaforma (niente header stripeAccount) e reverse_transfer richiama i fondi dalla struttura.
    // Pagamenti Stripe successivi al primo (saldo dal check-in): ciascuno ha il suo payment intent e si rimborsa per il SUO importo.
    const extraPays = (Array.isArray(b.stripeExtraPayments) ? (b.stripeExtraPayments as Json[]) : [])
      .map((x) => ({ pi: s(x.pi), amount: n(x.amount) })).filter((x) => x.pi && x.pi !== pi && x.amount > 0);
    let refunded = 0;
    if (free && paid > 0 && (pi || extraPays.length)) {
      if (!key) return NextResponse.json({ ok: false, error: "stripe_not_configured", message: "Rimborso non disponibile al momento: riprova più tardi o contatta la struttura." }, { status: 503 });
      try {
        const stripe = new Stripe(key);
        // idempotencyKey: se la richiesta si ripete (es. conflitto di scrittura, o un rimborso riuscito e uno no) non si rimborsa due volte.
        if (pi) {
          const r = await stripe.refunds.create({ payment_intent: pi, reverse_transfer: true }, { idempotencyKey: "guest-cancel-" + pi });
          // amount è in centesimi; se non fornito rimborsa l'intero pagamento.
          refunded += typeof r.amount === "number" ? Math.round(r.amount) / 100 : paid;
        }
        for (const ex of extraPays) {
          const cents = Math.round(ex.amount * 100);
          const r = await stripe.refunds.create({ payment_intent: ex.pi, amount: cents, reverse_transfer: true }, { idempotencyKey: "guest-cancel-" + ex.pi + "-" + cents });
          refunded += typeof r.amount === "number" ? Math.round(r.amount) / 100 : ex.amount;
        }
        refunded = Math.round(refunded * 100) / 100;
      } catch (e) {
        // Rimborso fallito: NON si annulla (l'ospite resterebbe senza soggiorno e senza rimborso). Errore chiaro, nessuna modifica.
        console.error("[manage-booking/cancel] rimborso fallito", { booking: s(b.id), pi, error: e instanceof Error ? e.message : e });
        return NextResponse.json({ ok: false, error: "refund_failed", message: "Non siamo riusciti a rimborsare il pagamento, quindi la prenotazione NON è stata annullata. Riprova tra qualche minuto o contatta la struttura." }, { status: 502 });
      }
    }

    // Quota dovuta ma NON rimborsata in automatico (es. incassi registrati a mano o prima del tracciamento dei pagamenti): va gestita dalla struttura.
    const unrefunded = free && paid > 0 ? Math.max(0, Math.round((paid - refunded) * 100) / 100) : 0;

    // Marca annullata (rev-locked). Manteniamo lo storico: status=cancelled + metadati.
    const wrote = await writeBookingPatch(admin, store, {
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: "guest",
      updatedAt: Date.now(),
      refundedAmount: refunded || undefined,
      note: [s(b.note), `Annullata dall'ospite il ${now.slice(0, 10)}${refunded > 0 ? ` — rimborso €${refunded}` : ""}${unrefunded > 0 ? ` — ATTENZIONE: rimborsati €${refunded} su €${paid}, il resto (€${unrefunded}) va gestito a mano` : ""}`].filter(Boolean).join(" · "),
    });
    if (!wrote) return NextResponse.json({ ok: false, error: "write_conflict" }, { status: 409 });

    // Email all'ospite (best-effort) + notifica al gestore.
    const origin = siteOrigin(req);
    const cancelPolicy = b.refundable
      ? (n(b.cancelDays) > 0 ? `Cancellazione gratuita fino a ${n(b.cancelDays)} giorni prima.` : "Cancellazione gratuita.")
      : "Tariffa non rimborsabile.";
    const gEmail = s(g.email);
    const code = s(b.code) || s(b.id).slice(0, 8).toUpperCase();
    const currency = s(st.currency) || "€";
    try {
      if (gEmail) {
        await internalFetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "cancel",
            booking: {
              code, structureName: s(st.name), structureEmail: s(st.email), color: s(st.photoColor),
              guestName: `${s(g.firstName)} ${s(g.lastName)}`.trim() || s(g.fullName) || gEmail, guestEmail: gEmail,
              guestPhone: s(g.phone) || undefined, guestCountry: s(g.country) || undefined, guestLanguage: s(g.language) || undefined, // lingua dell'email
              refundable: b.refundable === true, cancelDays: n(b.cancelDays),
              checkIn: s(b.checkIn), checkOut: s(b.checkOut), currency,
              refunded, cancelPolicy: refunded > 0 ? undefined : cancelPolicy,
            },
          }),
        });
      }
      // Notifica al gestore (usa il kind "quote" = testo semplice verso la struttura).
      const hostEmail = s(st.email);
      if (hostEmail) {
        await internalFetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "quote", to: hostEmail, subject: `Annullamento ${code} · ${s(st.name)}`,
            accent: "#b4472e",
            text: `L'ospite ha annullato la prenotazione ${code}.\n\nStruttura: ${s(st.name)}\nPeriodo: ${fmtDMY(s(b.checkIn))} → ${fmtDMY(s(b.checkOut))}\nOspite: ${`${s(g.firstName)} ${s(g.lastName)}`.trim() || gEmail}\n\nRimborso emesso: ${refunded > 0 ? `${currency} ${refunded}` : "nessuno"}${free && paid > 0 && refunded === 0 ? "\n\n⚠ Era dovuto un rimborso ma non è stato emesso in automatico (nessun pagamento online registrato): da gestire a mano." : unrefunded > 0 ? `\n\n⚠ Pagato in totale ${currency} ${paid}, rimborsati in automatico ${currency} ${refunded}: i restanti ${currency} ${unrefunded} (incassati in altro modo o non tracciati) vanno restituiti a mano.` : ""}`,
          }),
        });
      }
    } catch { /* email non critica */ }

    return NextResponse.json({ ok: true, refunded, free, freeUntil, unrefunded });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
