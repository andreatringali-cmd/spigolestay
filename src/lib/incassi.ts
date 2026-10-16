// Incassi — fonte di verità UNICA: la prenotazione (booking.paid).
// I pagamenti registrati sui documenti fiscali (document_payments) vengono
// propagati su booking.paid (vedi documenti/[id]), così "quanto ha pagato
// l'ospite" è un solo numero coerente ovunque (dashboard, incassi, cassa).
import type { Structure } from "./types";
import { bookingGrandTotal, cityTaxOfBooking } from "./booking";
import { roundCents } from "./money";

type PaidLike = { paid?: number };
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

export function balanceDue(b: TotalLike & PaidLike, structure: Structure | undefined): number {
  return Math.max(0, roundCents(totalDue(b, structure) - amountPaid(b)));
}

export type PayStatus = "saldato" | "acconto" | "da incassare";
export function paymentStatus(b: TotalLike & PaidLike, structure: Structure | undefined): PayStatus {
  const due = roundCents(totalDue(b, structure));
  const paid = Math.min(amountPaid(b), due);
  if (due <= 0 || paid >= due) return "saldato";
  return paid > 0 ? "acconto" : "da incassare";
}
