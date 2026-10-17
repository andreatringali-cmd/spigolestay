// Finto del pacchetto "stripe" PIU' COMPLETO di stripe-stub-loader.mjs (si registra DOPO stubs-loader.mjs): in piu' accounts.retrieve (charges_enabled),
// paymentIntents.retrieve, refunds.list (i rimborsi creati restano in un elenco, con i loro metadata), webhooks.constructEvent e sessioni con id.
// Le chiamate finiscono in globalThis.__stubs.calls (refund, sessionCreate, accountRetrieve). Configurazione in globalThis.__stubs:
//   session (risposta di checkout.sessions.retrieve), chargesEnabled, accountError, refundFail/refundFailCode, event (per constructEvent), piMeta, piDest.

const STRIPE = "data:text/javascript," + encodeURIComponent(`
  const S = (globalThis.__stubs ??= { calls: {} });
  const rec = (k, v) => { (S.calls[k] ??= []).push(v); };
  export default class Stripe {
    constructor() {
      this.refunds = {
        create: async (params, opts) => {
          rec("refund", { params, opts });
          if (S.refundFail) throw Object.assign(new Error(S.refundFail), { code: S.refundFailCode });
          const r = { id: "re_" + S.calls.refund.length, amount: S.refundAmount ?? params.amount ?? 10000, payment_intent: params.payment_intent, metadata: params.metadata ?? {} };
          (S.refundsDb ??= []).push(r);
          return r;
        },
        list: async (q) => ({ data: (S.refundsDb ?? []).filter((r) => !q?.payment_intent || r.payment_intent === q.payment_intent) }),
      };
      this.accounts = { retrieve: async (id) => { rec("accountRetrieve", id); if (S.accountError) throw new Error(S.accountError); return { id, charges_enabled: S.chargesEnabled ?? true }; } };
      this.paymentIntents = { retrieve: async (id) => ({ id, metadata: S.piMeta ?? {}, transfer_data: { destination: S.piDest ?? "acct_1" } }) };
      this.checkout = { sessions: {
        create: async (params) => { rec("sessionCreate", params); return { id: "cs_new", url: "https://stripe.test/pay" }; },
        retrieve: async () => S.session,
      } };
      this.webhooks = { constructEvent: () => { if (!S.event) throw new Error("no event"); return S.event; } };
    }
  }`);

export async function resolve(specifier, context, next) {
  if (specifier === "stripe") return { url: STRIPE, shortCircuit: true };
  return next(specifier, context);
}
