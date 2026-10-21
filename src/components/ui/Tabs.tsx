"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

// Schede (tabs) accessibili: role=tablist/tab/tabpanel, aria-selected, tabindex «mobile» (solo la scheda attiva è raggiungibile con Tab),
// frecce sinistra/destra (e Home/End) spostano e attivano la scheda. Bersaglio 40 px (44 su telefono), scorre di lato se non entra.
//  - variant «underline» (sottolineata, default) o «pill» (segmentata).
// Uso:
//   const id = useId();
//   <Tabs id={id} ariaLabel="Sezioni" value={tab} onChange={setTab} items={[{ value: "a", label: "Arrivi" }, { value: "b", label: "Partenze", badge: 3 }]} />
//   <TabPanel id={id} value="a" active={tab}>…contenuto…</TabPanel>
export interface TabItem { value: string; label: ReactNode; badge?: ReactNode; disabled?: boolean }

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  /** Nome della lista di schede per i lettori di schermo (serve se nessun titolo la introduce). */
  ariaLabel?: string;
  /** Base degli id (serve per collegare i TabPanel); se manca la genera React. */
  id?: string;
  variant?: "underline" | "pill";
  className?: string;
}

export const tabId = (base: string, value: string): string => `${base}-tab-${value}`;
export const panelId = (base: string, value: string): string => `${base}-panel-${value}`;

export function Tabs({ items, value, onChange, ariaLabel, id, variant = "underline", className }: TabsProps) {
  const auto = useId();
  const base = id ?? auto;
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = items.filter((i) => !i.disabled);

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return;
    const idx = enabled.findIndex((i) => i.value === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = enabled[next];
    onChange(target.value);
    // il focus segue la scheda attivata
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[id="${tabId(base, target.value)}"]`)?.focus());
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={move}
      className={cn("flex max-w-full gap-1 overflow-x-auto", variant === "underline" ? "border-b border-line" : "rounded-lg bg-wash p-1", className)}
    >
      {items.map((it) => {
        const sel = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            id={tabId(base, it.value)}
            aria-selected={sel}
            aria-controls={panelId(base, it.value)}
            tabIndex={sel ? 0 : -1}
            disabled={it.disabled}
            onClick={() => onChange(it.value)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-11",
              variant === "underline"
                ? cn("-mb-px border-b-2", sel ? "border-focus text-focus" : "border-transparent text-dim hover:text-txt")
                : cn("rounded-md", sel ? "bg-surface text-txt shadow-sm" : "text-dim hover:text-txt"),
            )}
          >
            {it.label}
            {it.badge != null && <span className="rounded-full bg-wash px-1.5 text-[11px] font-semibold leading-4 text-dim">{it.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Contenuto di una scheda. Resta nel DOM solo se è quella attiva (`active` = valore della scheda selezionata). */
export function TabPanel({ id, value, active, children, className }: { id: string; value: string; active: string; children: ReactNode; className?: string }) {
  if (active !== value) return null;
  return (
    <div role="tabpanel" id={panelId(id, value)} aria-labelledby={tabId(id, value)} tabIndex={0} className={cn("focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus", className)}>
      {children}
    </div>
  );
}
