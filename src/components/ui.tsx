import type { ReactNode } from "react";
import PageHelp from "./PageHelp";

export function PageHeader({ title, subtitle, actions, hideHelp }: { title: string; subtitle?: string; actions?: ReactNode; hideHelp?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-txt">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-dim">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {actions}
        {!hideHelp && <PageHelp />}
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`anim-in rounded-xl border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5 ${className}`}>{children}</div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">{children}</div>;
}

// Card riepilogo condivisa (etichetta piccola + numero grande). Unica fonte per tutte le pagine,
// così le stat card hanno per costruzione la stessa altezza (min-h) e lo stesso stile della dashboard.
export function StatCard({ label, value, color, hint, onClick, active }: { label: ReactNode; value: ReactNode; color?: string; hint?: ReactNode; onClick?: () => void; active?: boolean }) {
  const cls = `flex min-h-[92px] flex-col justify-center rounded-xl border bg-surface p-4 shadow-sm ${active ? "border-focus ring-2 ring-[color:var(--focus)]" : "border-line"} ${onClick ? "cursor-pointer text-left transition hover:-translate-y-0.5 hover:shadow-md" : ""}`;
  const inner = (<>
    <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</div>
    <div className="mt-1 font-mono text-2xl font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    {hint ? <div className="mt-0.5 text-[11px] text-faint">{hint}</div> : null}
  </>);
  return onClick ? <button type="button" onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>;
}
