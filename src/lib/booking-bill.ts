// Conto di una prenotazione da mandare all'ospite (extra, late checkout, voci libere e ciò che resta da pagare).
// Modulo puro: righe + testo del messaggio. La tassa di soggiorno NON entra nel conto: si incassa a parte con il suo link.
import { bookingExtrasTotal } from "./booking";
import { otaCoveredAmount, amountPaid } from "./incassi";
import { roundCents } from "./money";
import type { Booking, Structure } from "./types";

export interface BillLine { label: string; amount: number }
export interface Bill {
  lines: BillLine[];          // voci del conto: soggiorno, pulizia, extra
  total: number;              // somma delle voci
  paidAtPortal: number;       // già pagato all'OTA (quando incassa lei)
  paid: number;               // incassi registrati dalla struttura
  due: number;                // da pagare adesso
}

/** Righe del conto dalla prenotazione: stesse cifre di Gestione (nessun calcolo nuovo). */
export function billOf(b: Booking, structure: Structure | undefined): Bill {
  const lines: BillLine[] = [];
  const stay = b.total ?? 0;
  if (stay > 0) lines.push({ label: "Soggiorno", amount: roundCents(stay) });
  if ((b.cleaningFee ?? 0) > 0) lines.push({ label: "Pulizia finale", amount: roundCents(b.cleaningFee ?? 0) });
  for (const e of b.extras ?? []) {
    if (!e || !(e.price || 0)) continue;
    const q = e.qty && e.qty > 1 ? ` × ${e.qty}` : "";
    lines.push({ label: `${e.name || "Extra"}${q}`, amount: roundCents(e.price || 0) });
  }
  const total = roundCents(stay + (b.cleaningFee ?? 0) + bookingExtrasTotal(b));
  const paidAtPortal = otaCoveredAmount(b, structure);
  const paid = amountPaid(b);
  return { lines, total, paidAtPortal, paid, due: Math.max(0, roundCents(total - paidAtPortal - paid)) };
}

import { renderSystemMessage, type MsgLang } from "./msg-overrides";

const LABELS: Record<MsgLang, { paidPortal: string; paid: string; due: string; fallback: string }> = {
  it: { paidPortal: "Già pagato al portale", paid: "Già versato", due: "Da pagare", fallback: "la nostra struttura" },
  en: { paidPortal: "Already paid to the booking site", paid: "Already paid", due: "Amount due", fallback: "our property" },
  fr: { paidPortal: "Déjà payé au portail", paid: "Déjà versé", due: "Reste à payer", fallback: "notre établissement" },
  de: { paidPortal: "Bereits beim Portal bezahlt", paid: "Bereits bezahlt", due: "Zu zahlen", fallback: "unserer Unterkunft" },
  es: { paidPortal: "Ya pagado al portal", paid: "Ya abonado", due: "A pagar", fallback: "nuestro alojamiento" },
};
const fmt = (n: number): string => `€ ${n.toFixed(2).replace(".", ",")}`;

/** Testo del conto (WhatsApp/email). Il testo è MODIFICABILE (Messaggi → Modelli): qui si compone solo il riepilogo delle voci. */
export function billMessage(bill: Bill, o: { lang: string; name?: string; property?: string }): string {
  const lang = (["it", "en", "fr", "de", "es"] as const).find((l) => l === o.lang) ?? "en";
  const t = LABELS[lang];
  const rows = bill.lines.map((l) => `• ${l.label}: ${fmt(l.amount)}`);
  if (bill.paidAtPortal > 0) rows.push(`${t.paidPortal}: −${fmt(bill.paidAtPortal)}`);
  if (bill.paid > 0) rows.push(`${t.paid}: −${fmt(bill.paid)}`);
  rows.push(`${t.due}: ${fmt(bill.due)}`);
  return renderSystemMessage("bill", lang, { nome: o.name ?? "", struttura: o.property || t.fallback, riepilogo: rows.join("\n") });
}
