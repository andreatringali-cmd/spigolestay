// Costo d'incasso dell'OTA: quando Booking.com incassa il pagamento al posto della struttura trattiene una commissione di servizio sul pagamento
// (circa l'1,5%), separata dalla commissione di intermediazione. Booking la scrive nelle note: "Payment charge is EUR 13.9968".
/** Importo del "Payment charge" scritto nelle note dell'OTA, in euro con i centesimi; undefined se non c'è. */
export function parsePaymentCharge(text: string | undefined | null): number | undefined {
  const m = String(text ?? "").match(/payment\s+charge\s+is\s+(?:EUR|€)?\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}
