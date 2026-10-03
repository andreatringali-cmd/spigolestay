// Registrazione SERVER dell'incasso fatto dall'ospite col link di pagamento in chat.
// Chiamata sia dal webhook Stripe (fonte di verità) sia dalla pagina di ritorno: entrambe
// possono arrivare, in qualsiasi ordine e più volte — l'effetto è sempre UNA sola registrazione.
//  1) booking.paid += importo, booking.paidSessions += sessione (idempotente, rev-lock con retry);
//  2) messaggio di sistema "Pagamento ricevuto € X" nel thread del gestore (id pay:<sessione>,
//     stesso meccanismo rev-lock dei webhook WhatsApp). Passo indipendente: se il primo era già
//     stato fatto ma il messaggio no, viene aggiunto ora.
import type Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findBookingStoreForTenant, mutateStore } from "./manage-booking";
import { chatPayContext } from "./chat-pay";
import { applyChatPayment, appendPaymentNotice, paymentNoticeText, type ApplyPaymentResult, type ChatPayKind, type ThreadMsg } from "./chat-pay-core";
import type { Booking, Structure } from "./types";

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const THREADS_KEY = "spigolestay:threads:v1";

export type RecordChatPayResult =
  | { ok: true; booking: "recorded" | "already"; notice: "added" | "exists" | "failed"; amountCents: number; balanceAfterCents: number }
  | { ok: false; error: string };

export function adminFromEnv(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function recordChatPayment(admin: SupabaseClient, session: Stripe.Checkout.Session): Promise<RecordChatPayResult> {
  const m = (session.metadata ?? {}) as Record<string, string>;
  if (m.kind !== "chatpay" || !m.bid || !m.uid) return { ok: false, error: "not_chatpay_session" };
  if (session.payment_status !== "paid") return { ok: false, error: "not_paid" };
  const cents = Math.max(0, Math.round(session.amount_total ?? 0));
  if (cents <= 0) return { ok: false, error: "no_amount" };
  const kind: ChatPayKind = m.pk === "tassa" ? "tassa" : "saldo";

  const store = await findBookingStoreForTenant(admin, m.uid, m.bid);
  if (!store) return { ok: false, error: "booking_not_found" };
  const threadKey = String((store.booking as { guestId?: string }).guestId || "");

  // 1) incasso sulla prenotazione (la callback è ri-eseguita su dati freschi in caso di conflitto)
  let outcome: ApplyPaymentResult | null = null;
  const wrote = await mutateStore(admin, store, (data, idx) => {
    const bookings = arr(data.bookings);
    if (idx < 0 || idx >= bookings.length) return false;
    const bk = bookings[idx];
    const st = arr(data.structures).find((s) => s.id === bk.structureId);
    const ctx = chatPayContext(bk as unknown as Booking, st as unknown as Structure | undefined);
    const r = applyChatPayment(bk, { sessionId: session.id, cents, kind, balanceBeforeCents: ctx.balanceCents, cityTaxCents: ctx.cityTaxCents, cityTaxExempt: ctx.cityTaxExempt, now: Date.now() });
    outcome = r;
    if (!r.applied) return false;
    bookings[idx] = r.booking;
    data.bookings = bookings;
    return true;
  });
  const res = outcome as ApplyPaymentResult | null;
  if (!res) return { ok: false, error: "booking_not_found" };
  // applied ma scrittura non riuscita (conflitto di versione anche dopo il retry): fai ritentare.
  if (res.applied && !wrote) return { ok: false, error: "write_conflict" };

  // 2) messaggio di sistema in chat (best-effort ma con retry: mai far fallire l'incasso per questo)
  let notice: "added" | "exists" | "failed" = "failed";
  if (threadKey) {
    try {
      const text = paymentNoticeText({ cents, kind, balanceAfterCents: res.balanceAfterCents, overpaidCents: res.overpaidCents });
      notice = await addNoticeToThread(admin, m.uid, threadKey, session.id, text);
    } catch { notice = "failed"; }
  }
  return { ok: true, booking: res.applied ? "recorded" : "already", notice, amountCents: cents, balanceAfterCents: res.balanceAfterCents };
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
