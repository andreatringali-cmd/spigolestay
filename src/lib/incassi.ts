// Incassi — fonte di verità UNICA: la prenotazione (booking.paid).
// I pagamenti registrati sui documenti fiscali (document_payments) vengono
// propagati su booking.paid (vedi documenti/[id]), così "quanto ha pagato
// l'ospite" è un solo numero coerente ovunque (dashboard, incassi, cassa).
import type { Structure } from "./types";
import { bookingGrandTotal, bookingPaidTotal, cityTaxOfBooking } from "./booking";
import { roundCents } from "./money";
import { collectRuleOf, otaCollectsPayment } from "./pay-method";

type PaidLike = { paid?: number };
type CollectLike = Parameters<typeof otaCollectsPayment>[0] & { total?: number };
type TotalLike = Parameters<typeof bookingGrandTotal>[0];

export const amountPaid = (b: PaidLike): number => Math.max(0, roundCents(b.paid ?? 0));

/**
 * Quanto l'ospite deve in tutto, da confrontare con `paid`. Come bookingGrandTotal, ma se la tassa di soggiorno è già stata incassata A PARTE
 * (flag cityTaxPaid messo a mano: i contanti della tassa non entrano in `paid`) non si chiede una seconda volta. Se invece la tassa è stata pagata col link
 * "tassa" (cityTaxInPaid) quei soldi sono già dentro `paid`, quindi il totale resta com'è.
 */
export function totalDue(b: TotalLike, structure: Structure | undefined): number {
  const grand = bookingGrandTotal(b, structure);
  if (grand > 0 && b.cityTaxPaid && !b.cityTaxInPaid) return Math.max(0, roundCents(grand - cityTaxOfBooking(structure, b)));
  return grand;
}

/**
 * Quanto del soggiorno ha GIÀ pagato l'ospite all'OTA, quando è l'OTA a incassare (dato della prenotazione, oppure regola del canale nel Channel Manager).
 * Non è un incasso della struttura (non entra in `paid`, quindi non tocca Cassa e report): serve solo a non far risultare "da incassare" ciò che l'ospite
 * ha già pagato. Restano dovuti la tassa di soggiorno, gli extra e la pulizia aggiunti dalla struttura.
 */
export function otaCoveredAmount(b: CollectLike, structure: Structure | undefined): number {
  return otaCollectsPayment(b, collectRuleOf(structure, b.channel)) ? Math.max(0, roundCents(b.total ?? 0)) : 0;
}

/** Saldo del solo soggiorno (senza tassa): quanto manca al netto di ciò che l'ospite ha già pagato all'OTA quando incassa lei. Per liste, avvisi e dashboard. */
export function stayDue(b: Parameters<typeof bookingPaidTotal>[0] & PaidLike & CollectLike, structure: Structure | undefined): number {
  return Math.max(0, roundCents(bookingPaidTotal(b) - amountPaid(b) - otaCoveredAmount(b, structure)));
}

export function balanceDue(b: TotalLike & PaidLike & CollectLike, structure: Structure | undefined): number {
  return Math.max(0, roundCents(totalDue(b, structure) - amountPaid(b) - otaCoveredAmount(b, structure)));
}

export type PayStatus = "saldato" | "acconto" | "da incassare";
export function paymentStatus(b: TotalLike & PaidLike & CollectLike, structure: Structure | undefined): PayStatus {
  const due = roundCents(totalDue(b, structure));
  const paid = Math.min(amountPaid(b) + otaCoveredAmount(b, structure), due);
  if (due <= 0 || paid >= due) return "saldato";
  return paid > 0 ? "acconto" : "da incassare";
}
