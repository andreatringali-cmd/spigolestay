// Colonna "Stato" della vista Compatta delle prenotazioni: sempre gli stessi 8 passaggi, nello stesso ordine
// della vista Dettagliata. Se un passaggio non esiste per quella prenotazione (es. tassa non applicata, prenotazione
// annullata) lo slot resta al suo posto come "non applicabile", così le colonne restano allineate tra le righe.
// Funzione pura, senza dipendenze a runtime (solo tipi): collaudata in tests/journey-slots.test.ts.

import type { JourneyStep, StepState } from "./booking-journey";

export const SLOT_KEYS = ["checkin", "pay", "guide", "alloggiati", "istat", "tax", "invoice", "checkout"] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export const SLOT_LABELS: Record<SlotKey, string> = {
  checkin: "Check-in",
  pay: "Pagamento",
  guide: "Guida ospiti",
  alloggiati: "Schedina Questura",
  istat: "Osservatorio (ISTAT)",
  tax: "Tassa soggiorno",
  invoice: "Fattura",
  checkout: "Check-out",
};

export interface Slot {
  key: SlotKey;
  label: string;
  state: StepState;
  detail: string;
  /** Il passaggio reale del percorso (assente se per questa prenotazione non esiste). */
  step?: JourneyStep;
}

/** Sempre 8 slot, sempre nell'ordine SLOT_KEYS. `naDetail` = spiegazione per i passaggi mancanti. */
export function slotsOf(steps: JourneyStep[] | null | undefined, naDetail = "Non applicabile"): Slot[] {
  return SLOT_KEYS.map((key) => {
    const step = steps?.find((s) => s.key === key);
    if (!step) return { key, label: SLOT_LABELS[key], state: "na" as const, detail: naDetail };
    return { key, label: SLOT_LABELS[key], state: step.state, detail: step.detail, step };
  });
}
