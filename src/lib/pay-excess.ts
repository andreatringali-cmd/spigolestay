// Rimborsi AUTOMATICI lato server (puro rispetto al database: parla solo con Stripe).
//  - eccedenza: l'ospite ha pagato piu' del residuo (due click ravvicinati, due canali, link gia' pagato da un altro): si restituisce subito la differenza;
//  - prenotazione annullata nel frattempo: si restituisce tutto;
//  - doppio pagamento dello stesso preventivo: si restituisce la seconda sessione.
// Ogni rimborso porta una chiave di idempotenza (derivata dalla sessione): chiamarlo due volte (retry del webhook) non rimborsa due volte.
// I pagamenti sono DESTINATION CHARGE sulla piattaforma: il rimborso si crea sul conto piattaforma e reverse_transfer richiama i fondi dalla struttura.

export interface RefundResult { ok: boolean; id?: string; cents: number; already?: boolean; error?: string }

export async function refundPaymentIntent(paymentIntent: string, cents: number, idempotencyKey: string): Promise<RefundResult> {
  const c = Math.max(0, Math.round(cents));
  if (!paymentIntent || c <= 0) return { ok: true, cents: 0 };
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, cents: c, error: "stripe_not_configured" };
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(key);
    // La chiave di idempotenza di Stripe vale 24 ore: un retry piu' tardi del webhook potrebbe rimborsare due volte. Per questo la chiave viaggia anche nei
    // metadata del rimborso e si controlla prima se esiste gia'.
    try {
      const list = await stripe.refunds.list({ payment_intent: paymentIntent, limit: 50 });
      const hit = list.data.find((x) => x.metadata?.idem === idempotencyKey);
      if (hit) return { ok: true, id: hit.id, cents: 0, already: true };
    } catch { /* elenco non disponibile: si affida alla chiave di idempotenza */ }
    const r = await stripe.refunds.create({ payment_intent: paymentIntent, amount: c, reverse_transfer: true, metadata: { xenora: "auto", idem: idempotencyKey } }, { idempotencyKey });
    return { ok: true, id: r.id, cents: c };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    // Gia' rimborsato del tutto (es. dalla dashboard Stripe nel frattempo): niente da fare.
    if (err?.code === "charge_already_refunded") return { ok: true, cents: 0 };
    return { ok: false, cents: c, error: err?.message || "refund_failed" };
  }
}

/** Ripartisce `cents` sui residui delle righe (in ordine): ogni riga prende al massimo il suo residuo; l'eventuale avanzo resta sulla prima. */
export function allocateAcross(balancesCents: number[], cents: number): number[] {
  let left = Math.max(0, Math.round(cents));
  const out = balancesCents.map(() => 0);
  balancesCents.forEach((b, i) => { const g = Math.min(left, Math.max(0, Math.round(b))); out[i] = g; left -= g; });
  if (left > 0 && out.length) out[0] += left;
  return out;
}

/** Ripartisce `cents` in proporzione ai residui (acconto di un preventivo con piu' camere: ogni camera porta la sua quota). Mai oltre il residuo; l'arrotondamento va alla prima. */
export function allocateProportional(balancesCents: number[], cents: number): number[] {
  const bal = balancesCents.map((b) => Math.max(0, Math.round(b)));
  const sum = bal.reduce((a, v) => a + v, 0);
  const total = Math.min(Math.max(0, Math.round(cents)), sum);
  if (sum <= 0) return bal.map(() => 0);
  const out = bal.map((b) => Math.floor((total * b) / sum));
  let left = total - out.reduce((a, v) => a + v, 0);
  for (let i = 0; left > 0 && i < out.length; i++) { const room = bal[i] - out[i]; const g = Math.min(room, left); out[i] += g; left -= g; }
  return out;
}
