// Registrazione SERVER del saldo pagato dall'ospite al check-in (sessione Stripe kind "quote" con bookingId).
// Chiamata dal ritorno pagina (/api/checkin/pay-confirm) e dal webhook Stripe: in qualsiasi ordine e più volte l'effetto è UNA sola registrazione.
//  - prenotazione annullata nel frattempo: l'incasso non si registra e viene rimborsato;
//  - pagamento superiore al residuo (doppio click, due canali): si registra al massimo il residuo e l'eccedenza viene rimborsata;
//  - ogni incasso lascia payment intent (stripeExtraPayments), metodo "carta", paidOnline/paidAt e, se salda il residuo, i flag della tassa di soggiorno;
//  - avviso "Pagamento ricevuto" al titolare SOLO se acceso nelle Impostazioni → Notifiche (di default è spento).
import type { SupabaseClient } from "@supabase/supabase-js";
import { mutateStore, type BookingStore } from "./manage-booking";
import { chatPayContext } from "./chat-pay";
import { applyChatPayment } from "./chat-pay-core";
import { excessCentsOf, excessPatch } from "./chat-pay-server";
import { groupRowBalances } from "./booking";
import { allocateAcross, refundPaymentIntent } from "./pay-excess";
import { parseNotifPrefs } from "./notifPrefs";
import { notifyBookingLines } from "./booking-notify";
import { eur } from "./format";
import { internalFetch } from "@/lib/server-auth";
import { fmtDMY } from "./dates";
import type { Booking, Structure } from "./types";

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export interface CheckinSessionLike {
  id: string; payment_status?: string | null; amount_total?: number | null; metadata?: Record<string, string> | null;
  payment_intent?: string | { id?: string; transfer_data?: { destination?: string | { id?: string } | null } | null } | null;
}
export type CheckinPayResult =
  | { ok: true; amount: number; wrote: boolean; already?: boolean; refundedCents?: number }
  | { ok: false; status: number; error: string };

export async function recordCheckinPayment(admin: SupabaseClient, store: BookingStore, session: CheckinSessionLike, opts: { origin: string }): Promise<CheckinPayResult> {
  if (session.payment_status !== "paid") return { ok: false, status: 402, error: "not_paid" };
  const amountCents = Math.max(0, Math.round(session.amount_total ?? 0));
  const realBooking = store.booking as Json;
  // La sessione deve essere un pagamento di saldo di QUESTA prenotazione: non l'acconto già contato alla prenotazione (stripeSessionId / extId) né una sessione di un'altra prenotazione.
  if (session.metadata?.kind !== "quote" || s(session.metadata?.bookingId) !== s(realBooking.id)) return { ok: false, status: 409, error: "session_mismatch" };
  // bookingId e conto li sceglie /api/stripe/quote (ora dal server), ma si ricontrolla: se la struttura ha un conto collegato, il pagamento deve essere arrivato proprio a quel conto.
  const wantedAcct = s((store.structure as Json | null)?.stripeAccount);
  const piObj = typeof session.payment_intent === "object" && session.payment_intent ? session.payment_intent : null;
  if (wantedAcct && piObj) {
    const dest = piObj.transfer_data?.destination;
    const destId = typeof dest === "string" ? dest : (dest as { id?: string } | null | undefined)?.id || "";
    if (destId !== wantedAcct) return { ok: false, status: 400, error: "session_account_mismatch" };
  }
  if (s(realBooking.stripeSessionId) === session.id || s(realBooking.extId) === "stripe:" + session.id) return { ok: false, status: 409, error: "session_already_counted" };
  // Idempotenza: non risommare se questa sessione è già stata registrata.
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : (piObj?.id ?? "");
  const alreadyRegistered = arr(realBooking.paidSessions).some((x) => s(x) === session.id);

  interface Out { wrote: boolean; excessCents: number; amountAppliedCents: number; done: boolean }
  let out: Out = { wrote: false, excessCents: 0, amountAppliedCents: 0, done: false };
  if (alreadyRegistered) out = { wrote: false, excessCents: excessCentsOf(realBooking, pi), amountAppliedCents: 0, done: true };
  else {
    const wrote = await mutateStore(admin, store, (data, idx) => {
      const bookings = arr(data.bookings);
      if (idx < 0 || idx >= bookings.length) return false;
      const bk = bookings[idx] as Json;
      const sessions = arr(bk.paidSessions).map(String);
      if (sessions.includes(session.id)) { out = { wrote: false, excessCents: excessCentsOf(bk, pi), amountAppliedCents: 0, done: true }; return false; } // già registrata
      const now = Date.now();
      const st = arr(data.structures).find((x) => s(x.id) === s(bk.structureId)) as unknown as Structure | undefined;
      const owe = (c: number): Json => excessPatch(bk, pi, c);
      // Annullata nel frattempo: niente incasso, si restituisce tutto.
      if (s(bk.status) === "cancelled" || s(bk.status) === "no_show") {
        bookings[idx] = { ...bk, paidSessions: [...sessions, session.id], updatedAt: now, ...owe(amountCents) };
        data.bookings = bookings;
        out = { wrote: true, excessCents: amountCents, amountAppliedCents: 0, done: true };
        return true;
      }
      // Pagamento di GRUPPO (più camere prenotate insieme): l'importo si ripartisce sui residui di ogni camera (con la sua quota di tassa del gruppo), questa camera per prima.
      const gid = s(bk.groupId);
      if (session.metadata?.group === "1" && gid) {
        const idxs = bookings.map((x, i) => ({ x: x as Json, i })).filter(({ x }) => s(x.groupId) === gid && s(x.status) !== "cancelled" && s(x.status) !== "no_show" && s(x.channel) !== "blocked");
        if (idxs.some(({ x }) => arr(x.paidSessions).map(String).includes(session.id))) { out = { wrote: false, excessCents: idxs.reduce((mx, { x }) => Math.max(mx, excessCentsOf(x, pi)), 0), amountAppliedCents: 0, done: true }; return false; } // già ripartita su una camera del gruppo (l'eccedenza sta sulla camera che l'ha registrata)
        const bals = groupRowBalances(st, idxs.map(({ x }) => ({ id: s(x.id), adults: n(x.adults), children: n(x.children), childAges: (Array.isArray(x.childAges) ? (x.childAges as unknown[]).filter((v): v is number => typeof v === "number") : []), checkIn: s(x.checkIn), checkOut: s(x.checkOut), total: n(x.total), cityTaxExempt: x.cityTaxExempt === true, cleaningFee: n(x.cleaningFee), extras: arr(x.extras) as { price?: number }[], paid: n(x.paid), cityTaxPaid: x.cityTaxPaid === true, cityTaxInPaid: x.cityTaxInPaid === true })));
        const order = idxs.slice().sort((a, b) => (s(a.x.id) === s(bk.id) ? -1 : s(b.x.id) === s(bk.id) ? 1 : 0));
        const balOf = (id: string) => bals.find((r) => r.id === id);
        const caps = order.map(({ x }) => Math.round((balOf(s(x.id))?.balance ?? 0) * 100));
        const applyTotal = Math.min(amountCents, caps.reduce((a, v) => a + v, 0));
        const give = allocateAcross(caps, applyTotal); // niente avanzo: applyTotal non supera la somma dei residui
        const excess = amountCents - applyTotal;
        order.forEach(({ x, i }, k) => {
          const g = give[k];
          if (!g) { if (s(x.id) === s(bk.id)) bookings[i] = { ...x, paidSessions: [...arr(x.paidSessions).map(String), session.id], updatedAt: now, ...(k === 0 ? owe(excess) : {}) }; return; } // la sessione resta segnata anche su questa camera (idempotenza)
          const bal = balOf(s(x.id));
          const r = applyChatPayment(x, { sessionId: session.id, cents: g, kind: "saldo", balanceBeforeCents: caps[k], cityTaxCents: Math.round((bal?.tax ?? 0) * 100), cityTaxExempt: x.cityTaxExempt === true, now, paymentIntent: pi || undefined });
          bookings[i] = { ...r.booking, ...(k === 0 ? owe(excess) : {}) };
        });
        data.bookings = bookings;
        out = { wrote: true, excessCents: excess, amountAppliedCents: applyTotal, done: true };
        return true;
      }
      // Camera singola: stesse regole del link in chat (residuo, tassa di soggiorno, payment intent, metodo carta).
      const ctx = chatPayContext(bk as unknown as Booking, st, false, bookings as unknown as Booking[]);
      const before = Math.max(0, Math.round(ctx.balanceCents));
      const applied = Math.min(amountCents, before);
      const excess = amountCents - applied;
      if (applied <= 0) {
        bookings[idx] = { ...bk, paidSessions: [...sessions, session.id], updatedAt: now, ...owe(excess) };
      } else {
        const r = applyChatPayment(bk, { sessionId: session.id, cents: applied, kind: "saldo", balanceBeforeCents: before, cityTaxCents: ctx.cityTaxCents, cityTaxExempt: ctx.cityTaxExempt, now, paymentIntent: pi || undefined });
        bookings[idx] = { ...r.booking, ...owe(excess) };
      }
      data.bookings = bookings;
      out = { wrote: true, excessCents: excess, amountAppliedCents: applied, done: true };
      return true;
    }, { tables: "scope" }); // Fase 3, passo 3a: la funzione usa solo bookings e structures di data (scrittura su public.entities solo se l'autorita' e' 'table')
    if (!out.done) return { ok: false, status: 404, error: "not_found" };
    if (out.wrote && !wrote) return { ok: false, status: 409, error: "write_conflict" };
  }

  // Eccedenza / prenotazione annullata: rimborso automatico (idempotente). Se non riesce si risponde in errore: il webhook di Stripe ritenta.
  if (out.excessCents > 0 && pi) {
    const rf = await refundPaymentIntent(pi, out.excessCents, `checkin-excess-${session.id}`);
    if (!rf.ok) { console.error("[pay-confirm] rimborso eccedenza non riuscito:", rf.error, "session", session.id); return { ok: false, status: 502, error: "refund_failed" }; }
  }

  // Avviso al GESTORE: pagamento ricevuto — solo se acceso nelle Impostazioni → Notifiche (default spento) e solo alla prima registrazione.
  if (out.wrote && out.amountAppliedCents > 0 && parseNotifPrefs(store.blob["spigolestay:notifs"]).payment) {
    try {
      const st = (store.structure ?? {}) as Json;
      const b = store.booking as Json;
      const g = (store.guest ?? {}) as Json;
      const hostEmail = s(st.email);
      if (hostEmail) {
        const code = s(b.code) || s(b.id).slice(0, 8).toUpperCase();
        const guestName = s(g.fullName) || `${s(g.firstName)} ${s(g.lastName)}`.trim();
        const applied = out.amountAppliedCents / 100;
        const lines = notifyBookingLines({
          ev: "payment", paymentAmount: applied,
          booking: { code, checkIn: s(b.checkIn), checkOut: s(b.checkOut), adults: n(b.adults), children: n(b.children), total: n(b.total), paid: n(b.paid) + applied, cleaningFee: n(b.cleaningFee) },
          guest: { fullName: guestName, phone: s(g.phone), email: s(g.email), country: s(g.country) }, structureName: s(st.name), channelLabel: "Diretto",
        });
        const logo = s(st.logo);
        await internalFetch(`${opts.origin}/api/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "notify", to: hostEmail, event: "payment", subject: `Pagamento ricevuto ${code} · ${s(st.name)}`,
            text: `Hai ricevuto un pagamento di ${eur(applied)} per la prenotazione ${code}${guestName ? ` di ${guestName}` : ""} (${fmtDMY(s(b.checkIn))} → ${fmtDMY(s(b.checkOut))}).\n\n${lines.join("\n")}`,
            brand: { name: s(st.name), logoUrl: /^https?:\/\//i.test(logo) ? logo : undefined, color: s(st.photoColor) || undefined },
            booking: { structureName: s(st.name), structureEmail: hostEmail, color: s(st.photoColor) },
            ctaUrl: `${opts.origin}/prenotazioni?b=${encodeURIComponent(s(b.id))}`, ctaLabel: "Apri la prenotazione",
          }),
        });
      }
    } catch { /* notifica non critica */ }
  }
  return { ok: true, amount: amountCents / 100, wrote: out.wrote, ...(alreadyRegistered || (!out.wrote && out.done) ? { already: true } : {}), ...(out.excessCents > 0 ? { refundedCents: out.excessCents } : {}) };
}
