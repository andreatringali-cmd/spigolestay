// Politica di cancellazione della STRUTTURA (scheda struttura → Policy): l'unica regola per tutte le prenotazioni dirette (pagina di prenotazione, mini-sito) e per Google.
// Modulo puro, senza import: lo usano sia il browser (pagina di prenotazione) sia il server (acconti, rimborsi, dati inviati a Channex).
// I piani tariffari NON hanno più una cancellazione propria: tengono sconto, pasti, soggiorno minimo e caparra.

export type CancelKind = "flessibile" | "moderata" | "rigida";

/** Regola per ogni politica: cancellazione gratuita fino a N giorni prima dell'arrivo; Rigida = mai rimborsabile. */
export const CANCEL_RULES: Record<CancelKind, { refundable: boolean; days: number }> = {
  flessibile: { refundable: true, days: 1 },
  moderata: { refundable: true, days: 7 },
  rigida: { refundable: false, days: 0 },
};

export function cancelRuleOf(kind: unknown): { refundable: boolean; days: number } | null {
  return kind === "flessibile" || kind === "moderata" || kind === "rigida" ? CANCEL_RULES[kind] : null;
}

/** Applica la regola della struttura a un piano (o a un elenco di piani). Senza politica scelta nella scheda struttura, i piani restano come sono. */
export function withStructureCancel<T extends { refundable?: boolean; cancelDays?: number }>(plan: T, kind: unknown): T {
  const r = cancelRuleOf(kind);
  return r ? { ...plan, refundable: r.refundable, cancelDays: r.refundable ? r.days : 0 } : plan;
}
export function plansWithStructureCancel<T extends { refundable?: boolean; cancelDays?: number }>(plans: T[], kind: unknown): T[] {
  return cancelRuleOf(kind) ? plans.map((p) => withStructureCancel(p, kind)) : plans;
}

/** Frase per l'ospite («Cancellazione gratuita fino a 7 giorni prima»). */
export function cancelRuleText(kind: unknown): string {
  const r = cancelRuleOf(kind);
  if (!r) return "";
  if (!r.refundable) return "Non rimborsabile";
  return r.days === 1 ? "Cancellazione gratuita fino a 1 giorno prima" : `Cancellazione gratuita fino a ${r.days} giorni prima`;
}
