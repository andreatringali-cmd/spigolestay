// ============================================================
//  "Il pagamento dentro la chat" — logica PURA (nessun I/O, nessun import runtime).
//  Condivisa tra pannello Messaggi (browser), route server e test (node --test).
//  Tutti gli importi del calcolo sono in CENTESIMI interi.
//
//  Regole:
//   - l'importo del link NON si inventa: parte dal residuo della prenotazione (balanceDue)
//     ed è modificabile solo verso il BASSO: mai oltre il residuo, mai sotto il minimo Stripe;
//   - "saldo" = tutto il residuo (tassa di soggiorno inclusa, come in incassi.ts e nel check-in);
//     "tassa" = solo la tassa di soggiorno (se prevista, non esente, non già incassata);
//   - l'incasso si registra sulla prenotazione in modo idempotente (booking.paidSessions);
//   - in chat compare un messaggio di sistema con id deterministico (pay:<sessione>).
// ============================================================

export type ChatPayKind = "saldo" | "tassa";

/** Minimo accettato da Stripe per EUR: 0,50 €. */
export const MIN_CHARGE_CENTS = 50;

export const toCents = (eur: number): number => Math.round((Number(eur) || 0) * 100);

/** "€ 1.234,50" (formato italiano, sempre 2 decimali). */
export function fmtEur(cents: number): string {
  const v = (Number.isFinite(cents) ? cents : 0) / 100;
  return `€ ${v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Interpreta un importo scritto a mano ("120", "120,50", "1.200,50", "120.5"). null se non valido. */
export function parseEurInput(raw: string): number | null {
  let s = String(raw ?? "").trim().replace(/[€\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // 1.200,50 -> 1200.50
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface ChatPayContext {
  /** totale ospite (soggiorno + pulizia + extra + tassa), in centesimi */
  totalCents: number;
  /** residuo = totale − incassato, in centesimi (>= 0) */
  balanceCents: number;
  /** tassa di soggiorno calcolata, in centesimi */
  cityTaxCents: number;
  cityTaxExempt?: boolean;
  cityTaxPaid?: boolean;
  /** conto Stripe Connect collegato della STRUTTURA della prenotazione */
  stripeAccount?: string;
  stripeChargesEnabled?: boolean;
}

export type ChatPayError =
  | "no_total"            // prenotazione senza importo
  | "already_paid"        // niente da incassare
  | "stripe_not_connected"
  | "no_city_tax"         // la struttura non prevede la tassa / esente
  | "tax_already_paid"
  | "invalid_amount"
  | "amount_too_low"
  | "amount_exceeds_balance";

export const CHAT_PAY_ERROR_MSG: Record<ChatPayError, string> = {
  no_total: "Questa prenotazione non ha un importo: impostalo nella scheda prenotazione.",
  already_paid: "Il saldo è già stato pagato: non c'è nulla da incassare.",
  stripe_not_connected: "Stripe non è collegato per questa struttura: collegalo in Strutture → Pagamenti.",
  no_city_tax: "Per questa prenotazione non è prevista la tassa di soggiorno.",
  tax_already_paid: "La tassa di soggiorno risulta già incassata.",
  invalid_amount: "Importo non valido.",
  amount_too_low: `Importo troppo basso: il minimo è ${fmtEur(MIN_CHARGE_CENTS)}.`,
  amount_exceeds_balance: "L'importo supera il residuo da pagare.",
};

export type ChatPayPlan =
  | { ok: true; cents: number; maxCents: number }
  | { ok: false; error: ChatPayError; message: string; maxCents?: number };

const fail = (error: ChatPayError, maxCents?: number): ChatPayPlan => ({ ok: false, error, message: CHAT_PAY_ERROR_MSG[error], maxCents });

/** Importo massimo incassabile con un link, per tipo. 0 = nulla da incassare. */
export function maxChatPayCents(ctx: ChatPayContext, kind: ChatPayKind): number {
  const bal = Math.max(0, Math.round(ctx.balanceCents || 0));
  if (kind === "tassa") return Math.min(bal, Math.max(0, Math.round(ctx.cityTaxCents || 0)));
  return bal;
}

/**
 * Decide se (e per quanto) si può creare un link. requestedEur assente → importo massimo.
 * clamp=true (solo al click dell'ospite): se nel frattempo il residuo è sceso, riduce l'importo
 * invece di rifiutare; non alza mai oltre l'importo richiesto.
 */
export function planChatPayment(ctx: ChatPayContext, kind: ChatPayKind, requestedEur?: number | null, opts?: { clamp?: boolean }): ChatPayPlan {
  if ((ctx.totalCents || 0) <= 0) return fail("no_total");
  if ((ctx.balanceCents || 0) <= 0) return fail("already_paid");
  if (!ctx.stripeAccount || !ctx.stripeChargesEnabled) return fail("stripe_not_connected");
  if (kind === "tassa") {
    if ((ctx.cityTaxCents || 0) <= 0 || ctx.cityTaxExempt) return fail("no_city_tax");
    if (ctx.cityTaxPaid) return fail("tax_already_paid");
  }
  const max = maxChatPayCents(ctx, kind);
  if (max <= 0) return fail("already_paid");
  let cents: number;
  if (requestedEur === undefined || requestedEur === null) cents = max;
  else {
    if (typeof requestedEur !== "number" || !Number.isFinite(requestedEur) || requestedEur <= 0) return fail("invalid_amount", max);
    cents = toCents(requestedEur);
    if (cents <= 0) return fail("invalid_amount", max);
    if (cents > max) { if (opts?.clamp) cents = max; else return fail("amount_exceeds_balance", max); }
  }
  if (cents < MIN_CHARGE_CENTS) return fail("amount_too_low", max);
  return { ok: true, cents, maxCents: max };
}

// ── Registrazione dell'incasso sulla prenotazione (idempotente) ─────────────

type Json = Record<string, unknown>;

export interface ApplyPaymentInput {
  sessionId: string;
  /** importo realmente incassato (da Stripe: amount_total) */
  cents: number;
  kind: ChatPayKind;
  /** residuo della prenotazione PRIMA di questo pagamento, in centesimi */
  balanceBeforeCents: number;
  cityTaxCents: number;
  cityTaxExempt?: boolean;
  now: number;
}

export interface ApplyPaymentResult {
  booking: Json;
  applied: boolean;       // false = sessione già registrata (nulla da fare)
  balanceAfterCents: number;
  overpaidCents: number;  // > 0 se l'ospite ha pagato più del residuo (doppio pagamento)
}

/**
 * Applica un pagamento a una prenotazione: paid += importo, paidSessions += sessione.
 * Idempotente: se la sessione è già in paidSessions non cambia nulla.
 * Non inventa importi: usa solo i centesimi realmente incassati.
 */
export function applyChatPayment(booking: Json, p: ApplyPaymentInput): ApplyPaymentResult {
  const sessions = Array.isArray(booking.paidSessions) ? (booking.paidSessions as unknown[]).map(String) : [];
  const before = Math.max(0, Math.round(p.balanceBeforeCents || 0));
  if (!p.sessionId || sessions.includes(p.sessionId) || !(p.cents > 0)) {
    return { booking, applied: false, balanceAfterCents: before, overpaidCents: 0 };
  }
  const paidNow = typeof booking.paid === "number" && Number.isFinite(booking.paid) ? booking.paid : 0;
  const newPaid = Math.round((paidNow * 100 + p.cents)) / 100; // niente deriva dei float
  const patch: Json = { paid: newPaid, paidSessions: [...sessions, p.sessionId], updatedAt: p.now };
  // La tassa risulta incassata se pagata col link "tassa", oppure se il saldo (tassa inclusa) azzera il residuo.
  const taxApplies = (p.cityTaxCents || 0) > 0 && !p.cityTaxExempt;
  if (taxApplies && (p.kind === "tassa" || p.cents >= before)) patch.cityTaxPaid = true;
  return {
    booking: { ...booking, ...patch },
    applied: true,
    balanceAfterCents: Math.max(0, before - p.cents),
    overpaidCents: Math.max(0, p.cents - before),
  };
}

// ── Messaggio di sistema in chat ─────────────────────────────────────────────

export interface ThreadMsg { id: string; dir: "in" | "out"; text: string; ts: number; via?: string; sys?: "payment"; [k: string]: unknown }

export const PAYMENT_MSG_ID = (sessionId: string) => `pay:${sessionId}`;

export function paymentNoticeText(p: { cents: number; kind: ChatPayKind; balanceAfterCents: number; overpaidCents?: number }): string {
  const what = p.kind === "tassa" ? "tassa di soggiorno" : "saldo";
  const lines = [`💳 Pagamento ricevuto ${fmtEur(p.cents)} (${what})`];
  if (p.balanceAfterCents <= 0) lines.push("Prenotazione saldata ✓");
  else lines.push(`Resta da pagare ${fmtEur(p.balanceAfterCents)}`);
  if ((p.overpaidCents || 0) > 0) lines.push(`⚠ Eccedenza di ${fmtEur(p.overpaidCents!)} rispetto al residuo: verifica ed eventualmente rimborsa da Stripe`);
  return lines.join(" · ");
}

/** Aggiunge il messaggio di sistema al thread, se non già presente (id deterministico). Non muta l'input. */
export function appendPaymentNotice(threads: Record<string, ThreadMsg[]>, threadKey: string, notice: { sessionId: string; text: string; ts: number }): { threads: Record<string, ThreadMsg[]>; added: boolean } {
  const list = Array.isArray(threads[threadKey]) ? threads[threadKey] : [];
  const id = PAYMENT_MSG_ID(notice.sessionId);
  if (list.some((m) => m && m.id === id)) return { threads, added: false };
  // dir "out" (non "in"): così non conta come "da rispondere" nell'elenco conversazioni.
  const msg: ThreadMsg = { id, dir: "out", text: notice.text, ts: notice.ts, via: "💳 Pagamento", sys: "payment" };
  return { threads: { ...threads, [threadKey]: [...list, msg] }, added: true };
}

// ── Testo del messaggio all'ospite con il link ───────────────────────────────

export type GuestLang = "it" | "en" | "fr" | "de" | "es";

export function chatPayGuestMessage(lang: GuestLang, kind: ChatPayKind, cents: number, url: string): string {
  const a = fmtEur(cents);
  const T: Record<GuestLang, { saldo: string; tassa: string }> = {
    it: { saldo: `Puoi pagare il saldo del soggiorno (${a}) online con carta, in modo sicuro, da qui: ${url}`, tassa: `Puoi pagare la tassa di soggiorno (${a}) online con carta, in modo sicuro, da qui: ${url}` },
    en: { saldo: `You can pay the balance of your stay (${a}) online by card, securely, here: ${url}`, tassa: `You can pay the city tax (${a}) online by card, securely, here: ${url}` },
    fr: { saldo: `Vous pouvez régler le solde de votre séjour (${a}) en ligne par carte, en toute sécurité, ici : ${url}`, tassa: `Vous pouvez régler la taxe de séjour (${a}) en ligne par carte, en toute sécurité, ici : ${url}` },
    de: { saldo: `Den Restbetrag Ihres Aufenthalts (${a}) können Sie hier sicher online per Karte bezahlen: ${url}`, tassa: `Die Ortstaxe (${a}) können Sie hier sicher online per Karte bezahlen: ${url}` },
    es: { saldo: `Puedes pagar el saldo de tu estancia (${a}) online con tarjeta, de forma segura, aquí: ${url}`, tassa: `Puedes pagar la tasa turística (${a}) online con tarjeta, de forma segura, aquí: ${url}` },
  };
  return (T[lang] ?? T.it)[kind];
}
