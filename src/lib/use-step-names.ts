"use client";

// Nome dei passaggi della prenotazione (Check-in, Pagamento, Guida ospiti, Tassa, Check-out, Recensione) PRESO DAI MODELLI collegati (Messaggi → Modelli):
// se il titolare rinomina un modello, cambia anche il nome del passaggio. Senza modello collegato resta il nome di base.
import { useCallback, useEffect, useState } from "react";
import { readTemplates, type StoredTemplate } from "./template-fill";

/** Passaggio del percorso → collegamento (srcId) del modello. */
export const STEP_SRC: Record<string, string> = { checkin: "selfcheckin", pay: "pay", guide: "guida", tax: "tax", checkout: "checkout" };

export function stepNameFrom(templates: StoredTemplate[], stepKey: string, fallback: string, structureId?: string): string {
  const src = STEP_SRC[stepKey];
  if (!src) return fallback;
  const t = templates.find((x) => x.srcId === src && (!structureId || !x.structureIds?.length || x.structureIds.includes(structureId)));
  return t?.name?.trim() || fallback;
}

export function useStepNames(): (stepKey: string, fallback: string, structureId?: string) => string {
  const [templates, setTemplates] = useState<StoredTemplate[]>([]);
  const read = useCallback(() => setTemplates(readTemplates()), []);
  useEffect(() => {
    read();
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("focus", read); };
  }, [read]);
  return useCallback((stepKey, fallback, structureId) => stepNameFrom(templates, stepKey, fallback, structureId), [templates]);
}
