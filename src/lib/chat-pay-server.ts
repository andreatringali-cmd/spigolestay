// Registrazione SERVER dell'incasso fatto dall'ospite col link di pagamento in chat.
// Chiamata sia dal webhook Stripe (fonte di verità) sia dalla pagina di ritorno: entrambe
// possono arrivare, in qualsiasi ordine e più volte — l'effetto è sempre UNA sola registrazione.
//  1) booking.paid += importo, booking.paidSessions += sessione (idempotente, rev-lock con retry);
//  2) messaggio di sistema "Pagamento ricevuto € X" nel thread del gestore (id pay:<sessione>,
//     stesso meccanismo rev-lock dei webhook WhatsApp). Passo indipendente: se il primo era già
//     stato fatto ma il messaggio no, viene aggiunto ora.
//  3) se l'ospite ha pagato PIÙ del residuo (due click ravvicinati, link usato da due canali) o la prenotazione è stata annullata nel frattempo,
//     l'eccedenza (o tutto l'importo) viene RIMBORSATA in automatico, con chiave di idempotenza: nessun doppio rimborso ai retry.
import type Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findBookingStoreForTenant, mutateStore } from "./manage-booking";
import { chatPayContext } from "./chat-pay";
import { applyChatPayment, appendPaymentNotice, paymentNoticeText, type ChatPayKind, type ThreadMsg } from "./chat-pay-core";
import { refundPaymentIntent } from "./pay-excess";
import type { Booking, Structure } from "./types";

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const THREADS_KEY = "spigolestay:threads:v1";

export type RecordChatPayResult =
  | { ok: true; booking: "recorded" | "already"; notice: "added" | "exists" | "failed"; amountCents: number; balanceAfterCents: number; refundedCents?: number; refund?: "done" | "failed" | "none" }
  | { ok: false; error: string };

export function adminFromEnv(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

const piOf = (session: Stripe.Checkout.Session): string => (typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent as { id?: string } | null)?.id ?? "");
/** Centesimi già restituiti (o promessi in restituzione) su questo payment intent, annotati sulla prenotazione. */
export const refundedCentsOf = (bk: Json, pi: string): number => {
  const m = bk.stripeRefundedCents;
  return m && typeof m === "object" && pi ? Math.max(0, Math.round(Number((m as Record<string, unknown>)[pi]) || 0)) : 0;
};

/**
 * Eccedenza (o incasso su prenotazione annullata) DA RIMBORSARE su questo payment intent, annotata al momento della registrazione della sessione.
 * Marcatore DEDICATO (stripeExcessRefunded): NON usare `stripeRefundedCents`, che e' scritta anche dalla riconciliazione dei rimborsi manuali del titolare
 * (dashboard Stripe): una rielaborazione della sessione avrebbe scambiato un rimborso manuale per eccedenza e rimborsato due volte.
 */
export const excessCentsOf = (bk: Json, pi: string): number => {
  const m = bk.stripeExcessRefunded;
  return m && typeof m === "object" && pi ? Math.max(0, Math.round(Number((m as Record<string, unknown>)[pi]) || 0)) : 0;
};
/** Patch che annota l'eccedenza `cents` su `pi` (marcatore dedicato + cumulato condiviso con la riconciliazione, cosi' il webhook charge.refunded non la scala due volte da `paid`). */
export function excessPatch(bk: Json, pi: string, cents: number): Json {
  if (!pi || !(cents > 0)) return {};
  const prevRef = (bk.stripeRefundedCents && typeof bk.stripeRefundedCents === "object" ? bk.stripeRefundedCents : {}) as Record<string, number>;
  const prevEx = (bk.stripeExcessRefunded && typeof bk.stripeExcessRefunded === "object" ? bk.stripeExcessRefunded : {}) as Record<string, number>;
  return {
    stripeRefundedCents: { ...prevRef, [pi]: refundedCentsOf(bk, pi) + cents },
    stripeExcessRefunded: { ...prevEx, [pi]: excessCentsOf(bk, pi) + cents },
  };
}

interface Outcome { applied: boolean; cancelled: boolean; appliedCents: number; excessCents: number; balanceAfterCents: number }

export async function recordChatPayment(admin: SupabaseClient, session: Stripe.Checkout.Session): Promise<RecordChatPayResult> {
  const m = (session.metadata ?? {}) as Record<string, string>;
  if (m.kind !== "chatpay" || !m.bid || !m.uid) return { ok: false, error: "not_chatpay_session" };
  if (session.payment_status !== "paid") return { ok: false, error: "not_paid" };
  const cents = Math.max(0, Math.round(session.amount_total ?? 0));
  if (cents <= 0) return { ok: false, error: "no_amount" };
  const kind: ChatPayKind = m.pk === "tassa" ? "tassa" : "saldo";
  const pi = piOf(session);

  const store = await findBookingStoreForTenant(admin, m.uid, m.bid);
  if (!store) return { ok: false, error: "booking_not_found" };
  const threadKey = String((store.booking as { guestId?: string }).guestId || "");

  // 1) incasso sulla prenotazione (la callback è ri-eseguita su dati freschi in caso di conflitto)
  let outcome: Outcome | null = null;
  const wrote = await mutateStore(admin, store, (data, idx) => {
    const bookings = arr(data.bookings);
    if (idx < 0 || idx >= bookings.length) return false;
    const bk = bookings[idx];
    const sessions = arr(bk.paidSessions).map(String);
    // Sessione già registrata (webhook + ritorno pagina, o retry): l'eventuale eccedenza da rimborsare è quella già annotata sulla prenotazione col marcatore DEDICATO (mai la mappa dei rimborsi manuali).
    if (sessions.includes(session.id)) { outcome = { applied: false, cancelled: false, appliedCents: 0, excessCents: excessCentsOf(bk, pi), balanceAfterCents: 0 }; return false; }
    const now = Date.now();
    const st = arr(data.structures).find((s) => s.id === bk.structureId);
    // Prenotazione annullata nel frattempo: l'incasso NON si registra e si restituisce tutto.
    if (bk.status === "cancelled" || bk.status === "no_show") {
      bookings[idx] = { ...bk, paidSessions: [...sessions, session.id], updatedAt: now, ...excessPatch(bk, pi, cents) };
      data.bookings = bookings;
      outcome = { applied: true, cancelled: true, appliedCents: 0, excessCents: cents, balanceAfterCents: 0 };
      return true;
    }
    const ctx = chatPayContext(bk as unknown as Booking, st as unknown as Structure | undefined, false, bookings as unknown as Booking[]);
    const before = Math.max(0, Math.round(ctx.balanceCents));
    // Si registra al massimo il residuo: quanto avanza (doppio pagamento) viene rimborsato.
    const appliedCents = Math.min(cents, before);
    const excess = cents - appliedCents;
    const refunded = excessPatch(bk, pi, excess);
    if (appliedCents <= 0) {
      bookings[idx] = { ...bk, paidSessions: [...sessions, session.id], updatedAt: now, ...refunded };
      outcome = { applied: true, cancelled: false, appliedCents: 0, excessCents: excess, balanceAfterCents: before };
    } else {
      const r = applyChatPayment(bk, { sessionId: session.id, cents: appliedCents, kind, balanceBeforeCents: before, cityTaxCents: ctx.cityTaxCents, cityTaxExempt: ctx.cityTaxExempt, now, paymentIntent: pi || undefined });
      bookings[idx] = { ...r.booking, ...refunded };
      outcome = { applied: true, cancelled: false, appliedCents, excessCents: excess, balanceAfterCents: r.balanceAfterCents };
    }
    data.bookings = bookings;
    return true;
  }, { tables: "scope" }); // Fase 3, passo 3a: la funzione usa solo bookings e structures di data (scrittura su public.entities solo se l'autorita' e' 'table')
  const res = outcome as Outcome | null;
  if (!res) return { ok: false, error: "booking_not_found" };
  // applied ma scrittura non riuscita (conflitto di versione anche dopo il retry): fai ritentare.
  if (res.applied && !wrote) return { ok: false, error: "write_conflict" };

  // 2) rimborso automatico di eccedenza / pagamento su prenotazione annullata (idempotente: chiave derivata dalla sessione)
  let refund: "done" | "failed" | "none" = "none";
  if (res.excessCents > 0 && pi) {
    const rf = await refundPaymentIntent(pi, res.excessCents, `chatpay-excess-${session.id}`);
    refund = rf.ok ? "done" : "failed";
    if (!rf.ok) console.error("[chat-pay] rimborso eccedenza non riuscito:", rf.error, "session", session.id);
    // Rimborso non riuscito: 500 così Stripe ritenta l'evento (la registrazione dell'incasso è già fatta, il retry riprova solo il rimborso).
    if (!rf.ok) return { ok: false, error: "refund_failed" };
  }

  // 3) messaggio di sistema in chat (best-effort ma con retry: mai far fallire l'incasso per questo)
  let notice: "added" | "exists" | "failed" = "failed";
  if (threadKey) {
    try {
      const text = paymentNoticeText({ cents, kind, balanceAfterCents: res.balanceAfterCents, overpaidCents: res.excessCents, overpaidRefunded: refund === "done", cancelled: res.cancelled });
      notice = await addNoticeToThread(admin, m.uid, threadKey, session.id, text);
    } catch { notice = "failed"; }
  }
  return { ok: true, booking: res.applied ? "recorded" : "already", notice, amountCents: cents, balanceAfterCents: res.balanceAfterCents, refundedCents: refund === "done" ? res.excessCents : 0, refund };
}

// Stesso pattern rev-lock + retry di applyIncoming/applyStatuses nel webhook WhatsApp.
async function addNoticeToThread(admin: SupabaseClient, tenantId: string, threadKey: string, sessionId: string, text: string): Promise<"added" | "exists" | "failed"> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
    if (!row) return "failed";
    const blob = (((row as { data?: unknown }).data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number }).rev === "number" ? (row as { rev: number }).rev : null;
    let threads: Record<string, ThreadMsg[]>;
    try { threads = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { return "failed"; } // dato corrotto: non sovrascrivere
    if (!threads || typeof threads !== "object" || Array.isArray(threads)) return "failed";
    const r = appendPaymentNotice(threads, threadKey, { sessionId, text, ts: Date.now() });
    if (!r.added) return "exists";
    const nb = { ...blob, [THREADS_KEY]: JSON.stringify(r.threads) };
    let w = admin.from("app_state").update({ data: nb, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
    if (rev !== null) w = w.eq("rev", rev);
    const { data: updated, error } = await w.select("rev");
    if (error) return "failed";
    if (updated && updated.length > 0) return "added";
    // conflitto di rev: un altro processo ha scritto nel mentre, rileggi e riprova
  }
  return "failed";
}
