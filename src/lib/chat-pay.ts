// Contesto di pagamento di una prenotazione (client + server): usa gli STESSI calcoli unici
// dell'app (incassi.ts / booking.ts), così il residuo mostrato in chat coincide con quello
// del check-in online e con la scheda prenotazione. Nessun importo inventato.
import type { Booking, Structure } from "./types";
import { cityTaxOfBooking, cityTaxShareOf, bookingGrandTotal } from "./booking";
import { balanceDue } from "./incassi";
import { toCents, type ChatPayContext } from "./chat-pay-core";

// optimistic (solo browser): con un account Stripe collegato non blocca in anticipo sul flag salvato, che può essere vecchio;
// la verifica vera la fa il server (withLiveStripe).
// `all`: le prenotazioni dello store; se questa fa parte di un gruppo (più camere), la tassa è la sua quota di quella calcolata sull'insieme delle camere.
export function chatPayContext(b: Booking, st: Structure | undefined, optimistic = false, all?: Booking[]): ChatPayContext {
  const members = b.groupId && all ? all.filter((x) => x.groupId === b.groupId && x.status !== "cancelled" && x.status !== "no_show" && x.channel !== "blocked") : [];
  const tax = members.length > 1 && members.some((x) => x.id === b.id)
    ? cityTaxShareOf(st, members, b.id)
    : cityTaxOfBooking(st, b);
  return {
    totalCents: toCents(bookingGrandTotal(b, st)),
    balanceCents: toCents(balanceDue(b, st)),
    cityTaxCents: toCents(tax),
    cityTaxExempt: !!b.cityTaxExempt,
    cityTaxPaid: !!b.cityTaxPaid,
    stripeAccount: st?.stripeAccount || undefined,
    stripeChargesEnabled: !!st?.stripeChargesEnabled || (optimistic && !!st?.stripeAccount),
  };
}
