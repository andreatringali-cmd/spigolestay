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
