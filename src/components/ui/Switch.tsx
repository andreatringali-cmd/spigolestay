"use client";

import { cn } from "./cn";

// Interruttore on/off (Xenora DS 1). role="switch" + aria-checked; si usa con un'etichetta VISIBILE vicino (labelledBy)
// oppure con `label` (aria-label). Bersaglio di tocco esteso oltre la traccia (24x44) con un ::before invisibile.
//  - Traccia spenta in --line-strong (>= 3:1 anche in scuro), accesa in `color` (default --focus; per «attivo = ok» passa var(--ok)).
//  - Spazio/Invio lo attivano (è un <button>). disabled: opacità 50 %.
// Uso:
//   <Switch checked={on} onCheckedChange={setOn} label="Invio automatico" />
//   <Switch checked={on} onClick={() => setOn(!on)} />   // forma «vecchia» di components/Toggle.tsx
export interface SwitchProps {
  checked: boolean;
  onCheckedChange?: (next: boolean) => void;
  /** Compatibilità con i vecchi <Toggle onClick>: viene chiamato dopo onCheckedChange. */
  onClick?: () => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  /** Colore della traccia da acceso (CSS). */
  color?: string;
  id?: string;
  className?: string;
}

export function Switch({ checked, onCheckedChange, onClick, label, labelledBy, describedBy, disabled, color = "var(--focus)", id, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => { onCheckedChange?.(!checked); onClick?.(); }}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors before:absolute before:-inset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50", className)}
      style={{ backgroundColor: checked ? color : "var(--line-strong)" }}
    >
      <span aria-hidden="true" className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: checked ? "22px" : "2px" }} />
    </button>
  );
}
