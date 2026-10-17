import Stripe from "stripe";
import { siteOrigin } from "@/lib/server-auth";
import { internalFetch } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimited } from "@/lib/server-auth";
import { clientIp } from "@/lib/server-booking-guard";
import { findBookingStore, refundEligible, writeBookingPatch, stripeRefundPlan, unrefundedOf } from "@/lib/manage-booking";
import { refundedCentsOf } from "@/lib/chat-pay-server";
import { fmtDMY } from "@/lib/dates";
import { ymdRome } from "@/lib/dates-rome";
import { eur } from "@/lib/format";
import { plural } from "@/lib/plural";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);
// Stripe risponde "gia' rimborsato" se il pagamento e' stato restituito del tutto dalla dashboard nel frattempo: non e' un errore.
const alreadyRefunded = (e: unknown) => (e as { code?: string } | null)?.code === "charge_already_refunded";

/**
 * Rimborsa su Stripe i pagamenti online della prenotazione: il principale (per intero) se `main` e i successivi (saldo) ognuno per il SUO importo.
 * Chiavi di idempotenza fisse: una richiesta ripetuta non rimborsa due volte. Ritorna gli euro rimborsati; lancia se un rimborso fallisce.
 */
async function refundOnline(stripe: Stripe, b: Json, plan: ReturnType<typeof stripeRefundPlan>, main: boolean, paid: number): Promise<number> {
  let refunded = 0;
  const pi = s(b.stripePaymentIntent);
  if (main && pi) {
    try {
      const r = await stripe.refunds.create({ payment_intent: pi, reverse_transfer: true }, { idempotencyKey: "guest-cancel-" + pi });
      // amount è in centesimi; se non fornito rimborsa l'intero pagamento.
      refunded += typeof r.amount === "number" ? Math.round(r.amount) / 100 : paid;
    } catch (e) { if (!alreadyRefunded(e)) throw e; }
  }
  for (const ex of plan.extras) {
    const cents = Math.round(ex.amount * 100);
    try {
      const r = await stripe.refunds.create({ payment_intent: ex.pi, amount: cents, reverse_transfer: true }, { idempotencyKey: "guest-cancel-" + ex.pi + "-" + cents });
      refunded += typeof r.amount === "number" ? Math.round(r.amount) / 100 : ex.amount;
    } catch (e) { if (!alreadyRefunded(e)) throw e; }
  }
  return Math.round(refunded * 100) / 100;
}

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
      // Annullata nel frattempo dal webhook (rimborso del pagamento principale riconciliato) mentre il rimborso dei pagamenti successivi (saldo) non e' stato
      // eseguito: il retry dell'ospite li completa. Politica valutata al momento dell'annullamento; il principale solo se non risulta gia' rimborsato.
      const planC = stripeRefundPlan(b);
      // Solo se l'annullamento e' dell'ospite o il webhook ha gia' riconciliato un rimborso del principale (annullata a mano dal gestore = non si tocca) e
      // se quanto rimborsato finora e' meno di quanto l'annullamento rimborsa (stessa stima di GET): cosi' un doppio click su un annullamento riuscito non conta due volte.
      const mainRec = planC.main ? refundedCentsOf(b, planC.main) : 0;
      const pendingMain = !!planC.main && mainRec <= 0;
      const dueC = (s(b.cancelledBy) === "guest" || mainRec > 0) && refundEligible(b, s(b.cancelledAt) || new Date().toISOString()).free && n(b.paid) > 0
        && n(b.refundedAmount) + 0.005 < planC.estimate && (pendingMain || planC.extras.length > 0);
      if (!dueC) return NextResponse.json({ ok: true, already: true, refunded: n(b.refundedAmount), unrefunded: unrefundedOf(b) });
      if (!key) return NextResponse.json({ ok: false, error: "stripe_not_configured", message: "Rimborso non disponibile al momento: riprova più tardi o contatta la struttura." }, { status: 503 });
      let more = 0;
      try { more = await refundOnline(new Stripe(key), b, planC, pendingMain, n(b.paid)); }
      catch (e) {
        console.error("[manage-booking/cancel] rimborso (retry su annullata) fallito", { booking: s(b.id), error: e instanceof Error ? e.message : e });
        return NextResponse.json({ ok: false, error: "refund_failed", message: "Non siamo riusciti a completare il rimborso. Riprova tra qualche minuto o contatta la struttura." }, { status: 502 });
      }
      const totalRef = Math.round((n(b.refundedAmount) + more) * 100) / 100;
      const unref = Math.max(0, Math.round((n(b.paid) - totalRef) * 100) / 100);
      if (more > 0) await writeBookingPatch(admin, store, { refundedAmount: totalRef, unrefundedAmount: unref, updatedAt: Date.now() });
      return NextResponse.json({ ok: true, already: true, refunded: totalRef, unrefunded: unref });
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
    const extraPays = stripeRefundPlan(b).extras;
    let refunded = 0;
    if (free && paid > 0 && (pi || extraPays.length)) {
      if (!key) return NextResponse.json({ ok: false, error: "stripe_not_configured", message: "Rimborso non disponibile al momento: riprova più tardi o contatta la struttura." }, { status: 503 });
      try {
        // idempotencyKey: se la richiesta si ripete (es. conflitto di scrittura, o un rimborso riuscito e uno no) non si rimborsa due volte.
        refunded = await refundOnline(new Stripe(key), b, { main: pi, extras: extraPays, estimate: 0 }, !!pi, paid);
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
      unrefundedAmount: unrefunded, // pagato e non rimborsato: la pagina /gestisci non deve dire "nessun rimborso" (vedi unrefundedOf)
      note: [s(b.note), `Annullata dall'ospite il ${fmtDMY(ymdRome(Date.now()))}${refunded > 0 ? ` — rimborso ${eur(refunded)}` : ""}${unrefunded > 0 ? ` — ATTENZIONE: rimborsati ${eur(refunded)} su ${eur(paid)}, il resto (${eur(unrefunded)}) va gestito a mano` : ""}`].filter(Boolean).join(" · "),
    });
    if (!wrote) return NextResponse.json({ ok: false, error: "write_conflict" }, { status: 409 });

    // Email all'ospite (best-effort) + notifica al gestore.
    const origin = siteOrigin(req);
    const cancelPolicy = b.refundable
      ? (n(b.cancelDays) > 0 ? `Cancellazione gratuita fino a ${plural(n(b.cancelDays), "giorno", "giorni")} prima.` : "Cancellazione gratuita.")
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
              // unrefunded > 0: era dovuto un rimborso ma non e' stato emesso (tutto o in parte): l'email dice che la struttura contattera' l'ospite, non "nessun rimborso".
              refunded, unrefunded, cancelPolicy: refunded > 0 || unrefunded > 0 ? undefined : cancelPolicy,
            },
          }),
        });
      }
      // Notifica al gestore: kind "notify" (evento annullamento, carta intestata della struttura, link alla scheda).
      const hostEmail = s(st.email);
      if (hostEmail) {
        await internalFetch(`${origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "notify", event: "cancel", to: hostEmail, subject: `Annullamento ${code} · ${s(st.name)}`,
            accent: s(st.photoColor) || "#b4472e",
            brand: { name: s(st.name), logoUrl: /^https?:\/\//i.test(s(st.logo)) ? s(st.logo) : undefined, color: s(st.photoColor) || undefined }, structureName: s(st.name), channelLabel: "Diretto",
            ctaUrl: `${origin}/prenotazioni?b=${encodeURIComponent(s(b.id))}`, ctaLabel: "Apri la prenotazione",
            text: `L'ospite ha annullato la prenotazione ${code}.\n\nStruttura: ${s(st.name)}\nPeriodo: ${fmtDMY(s(b.checkIn))} → ${fmtDMY(s(b.checkOut))}\nOspite: ${`${s(g.firstName)} ${s(g.lastName)}`.trim() || gEmail}\n\nRimborso emesso: ${refunded > 0 ? `${eur(refunded, currency)}` : "nessuno"}${free && paid > 0 && refunded === 0 ? "\n\n⚠ Era dovuto un rimborso ma non è stato emesso in automatico (nessun pagamento online registrato): da gestire a mano." : unrefunded > 0 ? `\n\n⚠ Pagato in totale ${eur(paid, currency)}, rimborsati in automatico ${eur(refunded, currency)}: i restanti ${eur(unrefunded, currency)} (incassati in altro modo o non tracciati) vanno restituiti a mano.` : ""}`,
          }),
        });
      }
    } catch { /* email non critica */ }

    return NextResponse.json({ ok: true, refunded, free, freeUntil, unrefunded });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error", message: (e as Error)?.message ?? "errore" }, { status: 500 });
  }
}
