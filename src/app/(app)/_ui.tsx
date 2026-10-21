"use client";

// Primitive grafiche condivise di Adempimenti 2 (tinta, tessera con icona, pillola, riga vuota).
// La Dashboard ha il suo kit sobrio in _dashboard/_kit.tsx; qui resta solo ciò che altre pagine importano davvero.
// Qui non c'è logica di business: solo presentazione.
import type { ReactNode } from "react";
import Icon from "@/components/Icon";

/** Tinta morbida di un colore/token (sfondo di pill, tessere, icone). */
export const tint = (color: string, pct = 12) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Tessera quadrata con icona su fondo tinto. */
export function IconTile({ icon, color, size = "md" }: { icon: string; color: string; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-10 w-10 rounded-xl" : size === "sm" ? "h-7 w-7 rounded-lg" : "h-9 w-9 rounded-xl";
  return (
    <span className={`grid shrink-0 place-items-center ${box}`} style={{ backgroundColor: tint(color, 14), color }}>
      <Icon name={icon} size={size === "sm" ? 14 : size === "lg" ? 19 : 17} />
    </span>
  );
}

/** Pill tinta (stati, segnalazioni). */
export function Pill({ color, children, icon, title, className = "" }: { color: string; children: ReactNode; icon?: string; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`} style={{ backgroundColor: tint(color, 14), color }}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

/** Stato vuoto discreto per le liste. */
export function EmptyLine({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-line px-3 py-4 text-sm text-faint">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-wash text-faint"><Icon name={icon} size={14} /></span>
      {children}
    </div>
  );
}
