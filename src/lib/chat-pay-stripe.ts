// Verifica LIVE (solo server) che l'account Stripe collegato alla struttura possa incassare.
// Il flag salvato nella struttura (stripeChargesEnabled) si aggiorna solo quando si riapre la pagina della struttura:
// se l'onboarding è finito dopo, resterebbe "false" e il link di pagamento verrebbe rifiutato senza motivo.
import type { ChatPayContext } from "./chat-pay-core";

export async function withLiveStripe(ctx: ChatPayContext): Promise<ChatPayContext> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!ctx.stripeAccount || ctx.stripeChargesEnabled || !key) return ctx;
  try {
    const Stripe = (await import("stripe")).default;
    const a = await new Stripe(key).accounts.retrieve(ctx.stripeAccount);
    return { ...ctx, stripeChargesEnabled: !!a.charges_enabled };
  } catch {
    return ctx;
  }
}
