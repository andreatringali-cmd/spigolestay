// Si aggiunge A stubs-loader.mjs (va registrato DOPO): sostituisce il pacchetto "stripe" con un finto che registra i rimborsi
// in globalThis.__stubs.calls.refund (e le sessioni Checkout create in calls.sessionCreate; retrieve restituisce __stubs.session) e, se globalThis.__stubs.refundFail e' valorizzato, risponde con un errore.
import { resolve as aliasResolve } from "./alias-loader.mjs";

const STRIPE = "data:text/javascript," + encodeURIComponent(`
  const S = (globalThis.__stubs ??= { calls: {} });
  export default class Stripe {
    constructor() {
      this.refunds = { create: async (params, opts) => {
        (S.calls.refund ??= []).push({ params, opts });
        if (S.refundFail) throw new Error(S.refundFail);
        return { id: "re_1", amount: S.refundAmount ?? 10000 };
      } };
      this.checkout = { sessions: {
        create: async (params) => { (S.calls.sessionCreate ??= []).push(params); return { url: "https://stripe.test/pay" }; },
        retrieve: async () => S.session,
      } };
    }
  }`);

export async function resolve(specifier, context, next) {
  if (specifier === "stripe") return { url: STRIPE, shortCircuit: true };
  return next(specifier, context);
}
