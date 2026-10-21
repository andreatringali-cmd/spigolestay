// Riconciliazione di rimborsi e dispute Stripe sulle prenotazioni (webhook charge.refunded / charge.dispute.created).
// Si trova la prenotazione dal payment intent usando i metadata della sessione (bid/bookingId, uid, slug) invece di scorrere TUTTE le righe org_state/app_state;
// la scansione completa resta come ultima risorsa (con tetti alti), per i pagamenti vecchi senza metadata.
//  - rimborso parziale / rimborso di un pagamento successivo (saldo): `paid` (e paidOnline) scendono della quota rimborsata, una sola volta (stripeRefundedCents annota il cumulato);
//  - rimborso totale del pagamento principale: la prenotazione risulta annullata;
//  - dispute: segnalazione sulla prenotazione.
import type { SupabaseClient } from "@supabase/supabase-js";
import { refundedCentsOf } from "./chat-pay-server";
import { findBookingStoreById } from "./manage-booking";
import { entitiesReadMode, entitiesShadow, findBookingsByPaymentIntent, logCompare, ownerState } from "./server-entities";
import { eur } from "./format";
import { mutateEntitySet } from "./server-entities-write";

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const parse = (data: unknown): Json => { const b = ((data ?? {}) as Record<string, string>) || {}; try { return JSON.parse(b[DATA_KEY] || "{}") as Json; } catch { return {}; } };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

interface ChargeLike { amount?: number | null; amount_refunded?: number | null; metadata?: Record<string, string> | null; payment_intent?: string | { id?: string } | null }
type Target = { table: "app_state" | "org_state"; col: "user_id" | "org_id"; val: string };
export type ReconcileResult = "ok" | "none" | "failed";

/** Quanto resta da applicare alla prenotazione per questo payment intent: aggiorna paid/paidOnline/estrapagamenti o annulla. Puro, testabile. */
export function applyRefundToBooking(bk: Json, pi: string, charge: { amount: number; amountRefunded: number }, isDispute: boolean, nowMs: number): Json | null {
  const isMain = bk.stripePaymentIntent === pi;
  const extra = arr(bk.stripeExtraPayments).find((x) => x.pi === pi);
  if (!isMain && !extra) return null;
  if (isDispute) {
    if (bk.dispute === true) return null; // già segnalata
    return { ...bk, dispute: true, updatedAt: nowMs, note: [String(bk.note || ""), "⚠ Dispute Stripe aperta"].filter(Boolean).join(" · ") };
  }
  const recorded = refundedCentsOf(bk, pi);
  const refundedTotal = Math.max(0, Math.round(charge.amountRefunded));
  const total = Math.max(0, Math.round(charge.amount));
  const full = total > 0 && refundedTotal >= total;
  const delta = refundedTotal - recorded;
  const prev = (bk.stripeRefundedCents && typeof bk.stripeRefundedCents === "object" ? bk.stripeRefundedCents : {}) as Record<string, number>;
  const refundedMap = { ...prev, [pi]: Math.max(recorded, refundedTotal) };
  // Rimborso totale del pagamento PRINCIPALE: la prenotazione è annullata (come prima).
  if (isMain && full) {
    if (bk.status === "cancelled") return recorded >= refundedTotal ? null : { ...bk, stripeRefundedCents: refundedMap, updatedAt: nowMs };
    return { ...bk, status: "cancelled", cancelledBy: (bk.cancelledBy as string) || "host", cancelledAt: (bk.cancelledAt as string) || new Date(nowMs).toISOString(), refundedAmount: r2(refundedTotal / 100), stripeRefundedCents: refundedMap, updatedAt: nowMs };
  }
  // Rimborso parziale, o rimborso di un pagamento successivo (saldo): si scala solo la quota rimborsata, una volta.
  if (delta <= 0) return null;
  const d = delta / 100;
  const next: Json = { ...bk, paid: Math.max(0, r2(num(bk.paid) - d)), stripeRefundedCents: refundedMap, updatedAt: nowMs };
  if (typeof bk.paidOnline === "number") next.paidOnline = Math.max(0, r2(bk.paidOnline - d));
  if (extra) next.stripeExtraPayments = arr(bk.stripeExtraPayments).map((x) => (x.pi === pi ? { ...x, amount: Math.max(0, r2(num(x.amount) - d)) } : x));
  next.note = [String(bk.note || ""), `Rimborso ${full ? "" : "parziale "}Stripe ${eur(delta / 100)}`].filter(Boolean).join(" · ");
  return next;
}

const hasPiOf = (pi: string) => (b: Json) => b.stripePaymentIntent === pi || arr(b.stripeExtraPayments).some((x) => x.pi === pi);
const AMBIGUOUS_NOTE = "⚠ Rimborso Stripe su un pagamento condiviso da più camere: non attribuibile con certezza, da riconciliare a mano";

export interface RefundPlan {
  /** almeno una prenotazione cita questo payment intent */
  found: boolean;
  /** righe da riscrivere (indice nell'elenco + nuova versione) */
  changes: { idx: number; next: Json }[];
  /** più camere condividono il PI e non si capisce a quale attribuire il rimborso: non si tocca nessun importo, solo una nota */
  ambiguous?: boolean;
}

/**
 * Applica un rimborso/dispute a UNA prenotazione scelta tra quelle che citano il payment intent.
 * Preventivi multi-camera e saldi di gruppo: piu' righe hanno lo stesso PI (ognuna con la sua quota in stripeExtraPayments). Accreditare sempre la prima
 * scalava il pagato dalla camera sbagliata. Con piu' candidate: il rimborso "nuovo" (delta = rimborsato totale - gia' annotato su TUTTE le candidate) va alla riga
 * la cui quota residua coincide col delta, a parita' a quella annullata; se non c'e' una quota uguale, all'unica annullata; altrimenti ambiguo (nessun importo toccato).
 */
export function planRefundOnBookings(bookings: Json[], pi: string, charge: { amount: number; amountRefunded: number }, isDispute: boolean, nowMs: number): RefundPlan {
  const has = hasPiOf(pi);
  const cands: number[] = [];
  bookings.forEach((b, i) => { if (has(b)) cands.push(i); });
  if (!cands.length) return { found: false, changes: [] };
  const one = (i: number, ch = charge): RefundPlan["changes"] => { const next = applyRefundToBooking(bookings[i], pi, ch, isDispute, nowMs); return next ? [{ idx: i, next }] : []; };
  if (cands.length === 1) return { found: true, changes: one(cands[0]) };
  // Dispute: riguarda l'intero pagamento, quindi tutte le camere che lo citano.
  if (isDispute) return { found: true, changes: cands.flatMap((i) => one(i)) };
  const refundedTotal = Math.max(0, Math.round(charge.amountRefunded));
  const recordedSum = cands.reduce((a, i) => a + refundedCentsOf(bookings[i], pi), 0);
  const delta = refundedTotal - recordedSum;
  if (delta <= 0) return { found: true, changes: [] }; // gia' riconciliato
  const quotaOf = (i: number): number => {
    const b = bookings[i];
    if (b.stripePaymentIntent === pi) return Number.POSITIVE_INFINITY; // pagamento principale: copre tutto
    const ex = arr(b.stripeExtraPayments).find((x) => x.pi === pi);
    return ex ? Math.round(num(ex.amount) * 100) : 0;
  };
  const eligible = cands.filter((i) => quotaOf(i) > 0);
  const exact = eligible.filter((i) => Math.abs(quotaOf(i) - delta) <= 1);
  const cancelled = (list: number[]) => list.filter((i) => bookings[i].status === "cancelled");
  let pick = -1;
  if (exact.length === 1) pick = exact[0];
  else if (exact.length > 1) { const c = cancelled(exact); if (c.length === 1) pick = c[0]; }
  else { const c = cancelled(eligible); if (c.length === 1) pick = c[0]; }
  if (pick >= 0) {
    const eff = { amount: charge.amount, amountRefunded: refundedCentsOf(bookings[pick], pi) + delta };
    return { found: true, changes: one(pick, eff) };
  }
  // Ambiguo: nessun importo si sposta; si lascia una nota (una volta sola) sulle camere coinvolte.
  console.error("[stripe-reconcile] rimborso non attribuibile a una camera", { pi, delta, candidates: cands.length });
  const changes = cands.filter((i) => !String(bookings[i].note || "").includes(AMBIGUOUS_NOTE)).map((i) => ({ idx: i, next: { ...bookings[i], note: [String(bookings[i].note || ""), AMBIGUOUS_NOTE].filter(Boolean).join(" · "), updatedAt: nowMs } as Json }));
  return { found: true, changes, ambiguous: true };
}

export async function reconcileCharge(
  admin: SupabaseClient, ch: ChargeLike, pi: string, isDispute: boolean,
  lookupMeta?: () => Promise<Record<string, string>>,
): Promise<ReconcileResult> {
  if (!pi) return "none";
  const charge = { amount: Number(ch.amount) || 0, amountRefunded: Number(ch.amount_refunded) || 0 };

  const patchOnce = async (t: Target): Promise<"ok" | "none" | "conflict"> => {
    // Fase 3, passo 3a (src/lib/server-entities-write.ts): se l'autorita' delle prenotazioni di questo proprietario e' 'table' si riscrivono le righe di public.entities;
    // altrimenti ({ handled:false }, il caso di oggi) prosegue il percorso attuale sul blocco, invariato.
    const ownerType = t.table === "org_state" ? "o" : "u";
    const viaTables = await mutateEntitySet(admin, {
      ownerType, ownerId: t.val, kind: "bookings",
      load: async () => (await findBookingsByPaymentIntent(admin, pi)).filter((h) => h.owner.type === ownerType && h.owner.id === t.val).map((h) => h.row),
      compute: (list) => {
        const plan = planRefundOnBookings(list, pi, charge, isDispute, Date.now());
        if (!plan.found) return { action: "none" };
        return plan.changes.length ? { action: "changes", changes: plan.changes } : { action: "noop" };
      },
    });
    if (viaTables.handled) return viaTables.outcome === "ok" ? "ok" : viaTables.outcome === "none" ? "none" : "conflict";
    const { data: row } = await admin.from(t.table).select("data, rev").eq(t.col, t.val).maybeSingle();
    if (!row) return "none";
    const blob = (((row as { data?: unknown }).data ?? {}) as Record<string, string>) || {};
    const d = parse((row as { data?: unknown }).data);
    const bookings = arr(d.bookings);
    const plan = planRefundOnBookings(bookings, pi, charge, isDispute, Date.now());
    if (!plan.found) return "none";
    if (!plan.changes.length) return "ok"; // già riconciliata
    for (const c of plan.changes) bookings[c.idx] = c.next;
    d.bookings = bookings;
    const nb = { ...blob, [DATA_KEY]: JSON.stringify(d) };
    const rev = (row as { rev?: number }).rev;
    let w = admin.from(t.table).update({ data: nb, updated_at: new Date().toISOString() }).eq(t.col, t.val);
    if (typeof rev === "number") w = w.eq("rev", rev);
    const { data: u } = await w.select("rev");
    return u && u.length > 0 ? "ok" : "conflict";
  };
  // Un retry su conflitto di rev (il proprietario ha salvato nel frattempo): riletto e riapplicato.
  const patchIn = async (t: Target) => { const r1 = await patchOnce(t); return r1 === "conflict" ? await patchOnce(t) : r1; };

  let conflict = false;
  let matched: Target | null = null; // ultimo bersaglio riconciliato (serve al confronto con le tabelle)
  const tryTargets = async (targets: Target[]): Promise<boolean> => {
    for (const t of targets) { const r = await patchIn(t); if (r === "ok") { matched = t; return true; } if (r === "conflict") conflict = true; }
    return false;
  };
  const targetsForUser = async (uid: string): Promise<Target[]> => {
    const out: Target[] = [];
    const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", uid);
    for (const m of arr(ms)) if (m.org_id) out.push({ table: "org_state", col: "org_id", val: String(m.org_id) });
    out.push({ table: "app_state", col: "user_id", val: uid });
    return out;
  };

  // 1) Metadata della carica / del payment intent: il proprietario o la prenotazione sono scritti dal server in ogni sessione.
  let meta: Record<string, string> = { ...(ch.metadata ?? {}) };
  if (!meta.uid && !meta.slug && !meta.bid && !meta.bookingId && lookupMeta) { try { meta = { ...meta, ...(await lookupMeta()) }; } catch { /* metadata non disponibili */ } }
  const bid = meta.bid || meta.bookingId || "";
  if (bid) {
    const store = await findBookingStoreById(admin, bid);
    if (store) { if (await tryTargets([{ table: store.table, col: store.keyCol, val: store.keyVal }])) return "ok"; }
  }
  let uid = meta.uid || "";
  if (!uid && meta.slug) {
    const { data: site } = await admin.from("public_sites").select("user_id").eq("slug", meta.slug).maybeSingle();
    uid = String((site as { user_id?: string } | null)?.user_id || "");
  }
  if (uid) { if (await tryTargets(await targetsForUser(uid))) return "ok"; }
  if (bid || uid) return conflict ? "failed" : "none"; // il proprietario era noto: inutile scorrere tutti gli altri

  // 2) Ultima risorsa: pagamenti senza metadata.
  // Con SERVER_READ_ENTITIES=on i proprietari si trovano cercando il payment intent nella tabella entities (niente scansione dei blocchi);
  // se la tabella da' errore si ripiega sulla scansione. La scrittura resta sul blocco.
  const targetKey = (t: Target) => t.table + ":" + t.val;
  const entityTargets = async (): Promise<Target[]> => {
    const seen = new Set<string>();
    const out: Target[] = [];
    for (const h of await findBookingsByPaymentIntent(admin, pi)) {
      const { table, keyCol } = ownerState(h.owner);
      const t: Target = { table, col: keyCol, val: h.owner.id };
      if (!seen.has(targetKey(t))) { seen.add(targetKey(t)); out.push(t); }
    }
    return out;
  };
  if (entitiesReadMode() === "on") {
    try {
      if (await tryTargets(await entityTargets())) return "ok";
      return conflict ? "failed" : "none";
    } catch (e) { logCompare("warn", { label: "stripe-reconcile.lastResort", result: "fallback_to_block", message: e instanceof Error ? e.message.slice(0, 300) : String(e) }); }
  }
  // In compare il risultato resta quello della scansione; si registra solo se le tabelle avrebbero indicato lo stesso proprietario.
  matched = null;
  const shadow = () => entitiesShadow<string | null>("stripe-reconcile.lastResort", matched ? targetKey(matched) : null, async () => {
    const keys = (await entityTargets()).map(targetKey);
    return matched && keys.includes(targetKey(matched)) ? targetKey(matched) : (keys[0] ?? null);
  });
  // Scansione di tutte le righe (limiti alti: con molti tenant un tetto basso lasciava prenotazioni non riconciliate).
  const { data: orgs } = await admin.from("org_state").select("org_id").limit(5000);
  if (await tryTargets(arr(orgs).map((o) => ({ table: "org_state" as const, col: "org_id" as const, val: String(o.org_id) })))) { await shadow(); return "ok"; }
  const { data: users } = await admin.from("app_state").select("user_id").limit(20000);
  if (await tryTargets(arr(users).map((u) => ({ table: "app_state" as const, col: "user_id" as const, val: String(u.user_id) })))) { await shadow(); return "ok"; }
  await shadow();
  return conflict ? "failed" : "none";
}
