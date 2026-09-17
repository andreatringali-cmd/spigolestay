// Incassi — fonte di verità UNICA: la prenotazione (booking.paid).
// I pagamenti registrati sui documenti fiscali (document_payments) vengono
// propagati su booking.paid (vedi documenti/[id]), così "quanto ha pagato
// l'ospite" è un solo numero coerente ovunque (dashboard, incassi, cassa).
import type { Structure } from "./types";
import { bookingGrandTotal } from "./booking";

type PaidLike = { paid?: number };
type TotalLike = Parameters<typeof bookingGrandTotal>[0];

export const amountPaid = (b: PaidLike): number => Math.max(0, b.paid ?? 0);

export function balanceDue(b: TotalLike & PaidLike, structure: Structure | undefined): number {
  return Math.max(0, bookingGrandTotal(b, structure) - amountPaid(b));
}

export type PayStatus = "saldato" | "acconto" | "da incassare";
export function paymentStatus(b: TotalLike & PaidLike, structure: Structure | undefined): PayStatus {
  const due = bookingGrandTotal(b, structure);
  const paid = Math.min(amountPaid(b), due);
  if (due <= 0 || paid >= due) return "saldato";
  return paid > 0 ? "acconto" : "da incassare";
}
