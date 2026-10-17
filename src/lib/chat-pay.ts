// Contesto di pagamento di una prenotazione (client + server): usa gli STESSI calcoli unici
// dell'app (incassi.ts / booking.ts), così il residuo mostrato in chat coincide con quello
// del check-in online e con la scheda prenotazione. Nessun importo inventato.
import type { Booking, Structure } from "./types";
import { cityTaxOfBooking, cityTaxShareOf, bookingGrandTotal, bookingExtrasTotal, groupRowBalances } from "./booking";
import { balanceDue } from "./incassi";
import { toCents, type ChatPayContext } from "./chat-pay-core";

// optimistic (solo browser): con un account Stripe collegato non blocca in anticipo sul flag salvato, che può essere vecchio;
// la verifica vera la fa il server (withLiveStripe).
// `all`: le prenotazioni dello store; se questa fa parte di un gruppo (più camere), la tassa è la sua quota di quella calcolata sull'insieme delle camere.
export function chatPayContext(b: Booking, st: Structure | undefined, optimistic = false, all?: Booking[]): ChatPayContext {
  const members = b.groupId && all ? all.filter((x) => x.groupId === b.groupId && x.status !== "cancelled" && x.status !== "no_show" && x.channel !== "blocked") : [];
  const inGroup = members.length > 1 && members.some((x) => x.id === b.id);
  const tax = inGroup ? cityTaxShareOf(st, members, b.id) : cityTaxOfBooking(st, b);
  // Camera di un GRUPPO: totale e residuo con la QUOTA di tassa del gruppo anche sul server (dove le quote di gruppo dello store del browser non esistono):
  // balanceDue/bookingGrandTotal userebbero la tassa della singola camera e il residuo non coinciderebbe con quello del gruppo.
  const groupBal = inGroup ? groupRowBalances(st, members.map((m) => ({ id: m.id, adults: m.adults, children: m.children, childAges: m.childAges, checkIn: m.checkIn, checkOut: m.checkOut, total: m.total, cityTaxExempt: m.cityTaxExempt, cleaningFee: m.cleaningFee, extras: m.extras, paid: m.paid, cityTaxPaid: m.cityTaxPaid, cityTaxInPaid: (m as { cityTaxInPaid?: boolean }).cityTaxInPaid }))).find((r) => r.id === b.id) : undefined;
  return {
    totalCents: inGroup ? ((b.total ?? 0) ? toCents((b.total ?? 0) + (b.cleaningFee ?? 0) + bookingExtrasTotal(b) + tax) : 0) : toCents(bookingGrandTotal(b, st)),
    balanceCents: groupBal ? toCents(groupBal.balance) : toCents(balanceDue(b, st)),
    cityTaxCents: toCents(tax),
    cityTaxExempt: !!b.cityTaxExempt,
    cityTaxPaid: !!b.cityTaxPaid,
    stripeAccount: st?.stripeAccount || undefined,
    stripeChargesEnabled: !!st?.stripeChargesEnabled || (optimistic && !!st?.stripeAccount),
    bookingStatus: b.status,
  };
}
