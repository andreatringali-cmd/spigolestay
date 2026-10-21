import type { ReactNode } from "react";
import PageHelp from "./PageHelp";

// Ponte verso il design system: i componenti base (Button, Field, Input, Select, Textarea, Badge, Modal, Tabs, Switch, DataTable, Alert…)
// vivono in components/ui/ e si importano anche da qui. Le regole d'uso sono in docs/DESIGN-SYSTEM.md.
export * from "./ui/index";

export function PageHeader({ title, subtitle, actions, hideHelp }: { title: string; subtitle?: string; actions?: ReactNode; hideHelp?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 max-w-full max-sm:w-full">
        {/* Su telefono il «?» sta a destra del titolo (non su una riga a sé sotto il sottotitolo): meno spazio perso */}
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-txt">{title}</h1>
          {!hideHelp && <span className="sm:hidden"><PageHelp /></span>}
        </div>
        {subtitle && <p className="mt-0.5 text-sm text-dim">{subtitle}</p>}
      </div>
      <div className={`flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:gap-3 ${actions ? "" : "max-sm:hidden"}`}>
        {actions}
        {!hideHelp && <span className="max-sm:hidden"><PageHelp /></span>}
      </div>
    </div>
  );
}

// Card unica. Di base è statica (bordo + ombra leggera): l'alzata al passaggio (hover) c'è SOLO con `interactive`, per non far sembrare cliccabile ciò che non lo è.
// `animate={false}` toglie l'animazione d'entrata (card dentro finestre/elenchi lunghi); `padding="none"` per tabelle a filo.
export function Card({ children, className = "", interactive = false, animate = true, padding = "md" }: { children: ReactNode; className?: string; interactive?: boolean; animate?: boolean; padding?: "none" | "sm" | "md" }) {
  return (
    <div className={`${animate ? "anim-in " : ""}rounded-xl border border-line bg-surface shadow-sm ${padding === "none" ? "" : padding === "sm" ? "p-3" : "p-4 sm:p-5"} ${interactive ? "transition-shadow hover:shadow-md" : ""} ${className}`}>{children}</div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-dim">{children}</div>;
}

// Card riepilogo condivisa (etichetta piccola + numero grande). Unica fonte per tutte le pagine,
// così le stat card hanno per costruzione la stessa altezza (min-h) e lo stesso stile della dashboard.
export function StatCard({ label, value, color, hint, onClick, active }: { label: ReactNode; value: ReactNode; color?: string; hint?: ReactNode; onClick?: () => void; active?: boolean }) {
  const cls = `flex min-h-[92px] flex-col justify-center rounded-xl border bg-surface p-4 shadow-sm max-sm:min-h-[72px] max-sm:p-3 ${active ? "border-focus ring-2 ring-[color:var(--focus)]" : "border-line"} ${onClick ? "cursor-pointer text-left transition hover:-translate-y-0.5 hover:shadow-md" : ""}`;
  const inner = (<>
    <div className="text-[11px] font-semibold uppercase tracking-wide text-dim">{label}</div>
    <div className="mt-1 font-mono text-2xl font-bold tabular-nums max-sm:text-[clamp(0.95rem,4.6vw,1.25rem)]" style={color ? { color } : undefined}>{value}</div>
    {hint ? <div className="mt-0.5 text-[11px] text-faint">{hint}</div> : null}
  </>);
  return onClick ? <button type="button" onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>;
}
