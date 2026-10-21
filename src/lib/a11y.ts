// Accessibilità: rende azionabile da tastiera un elemento NON-pulsante che ha già un onClick (riga di tabella, scheda cliccabile…).
// Uso:   <tr onClick={() => apri(r)} {...keyActivate(() => apri(r))}>
//   - aggiunge tabIndex=0 (raggiungibile con Tab) e onKeyDown: Invio o Spazio eseguono l'azione;
//   - agisce solo se il tasto è premuto sulla riga stessa (non su un pulsante, link o campo al suo interno);
//   - con `role: "button"` dichiara anche il ruolo (solo se dentro NON ci sono altri controlli);
//   - con fn assente (undefined/null) non aggiunge nulla: la riga non cliccabile resta fuori dall'ordine di tabulazione.
// Dove è possibile preferisci un vero <button> o <a>: questo è il ripiego per righe/schede intere.
export interface KeyActivateProps {
  tabIndex?: 0;
  role?: "button";
  onKeyDown?: (e: { key: string; target: unknown; currentTarget: unknown; preventDefault: () => void }) => void;
}

export function keyActivate(fn: (() => void) | null | undefined, opts?: { role?: "button" }): KeyActivateProps {
  if (!fn) return {};
  return {
    tabIndex: 0,
    ...(opts?.role ? { role: opts.role } : {}),
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    },
  };
}
