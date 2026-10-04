// Contesto di pagamento di una prenotazione (client + server): usa gli STESSI calcoli unici
// dell'app (incassi.ts / booking.ts), così il residuo mostrato in chat coincide con quello
// del check-in online e con la scheda prenotazione. Nessun importo inventato.
import type { Booking, Structure } from "./types";
import { cityTaxOf, cityTaxPayers, bookingGrandTotal } from "./booking";
import { balanceDue } from "./incassi";
import { nights } from "./dates";
import { toCents, type ChatPayContext } from "./chat-pay-core";

// optimistic (solo browser): con un account Stripe collegato non blocca in anticipo sul flag salvato, che può essere vecchio;
// la verifica vera la fa il server (withLiveStripe).
export function chatPayContext(b: Booking, st: Structure | undefined, optimistic = false): ChatPayContext {
  const tax = cityTaxOf(st, cityTaxPayers(st, b), nights(b.checkIn, b.checkOut), b.total ?? 0, b.cityTaxExempt);
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
