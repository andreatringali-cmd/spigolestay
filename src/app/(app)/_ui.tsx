"use client";

// Primitive grafiche della Dashboard: stesso linguaggio visivo di "Prenotazioni · Dettagliata"
// (card rounded-2xl, intestazioni con contatore, pill/pallini tinti, anteprima camera, barre sottili).
// Qui non c'è logica di business: solo presentazione.
import type { CSSProperties, ReactNode } from "react";
import { useData } from "@/lib/store";
import Icon from "@/components/Icon";

/** Tinta morbida di un colore/token (sfondo di pill, tessere, icone). */
export const tint = (color: string, pct = 12) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export const daysFrom = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);

export const EYEBROW = "text-[10px] font-semibold uppercase tracking-wide text-faint"; // come le card della dashboard

/** Card base: grande, respirata, hover con bordo --focus e ombra morbida. */
export function Panel({ children, className = "", style, hover = true }: { children: ReactNode; className?: string; style?: CSSProperties; hover?: boolean }) {
  return (
    <div className={`anim-in rounded-2xl border border-line bg-surface p-4 shadow-sm transition sm:p-5 ${hover ? "hover:border-focus hover:shadow-md" : ""} ${className}`} style={style}>
      {children}
    </div>
  );
}

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

/** Pill con pallino colorato (stato verde/ambra/rosso). */
export function DotPill({ color, children, title }: { color: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: tint(color, 12), color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

/** Barra di avanzamento sottile. */
export function Bar({ pct, color = "var(--focus)", className = "" }: { pct: number; color?: string; className?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-wash ${className}`}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }} />
    </div>
  );
}

/** Intestazione di una card: icona tinta, titolo forte, contatore, slot a destra. */
export function PanelHead({ icon, color, title, count, sub, right }: { icon: string; color: string; title: ReactNode; count?: number | string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconTile icon={icon} color={color} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-bold leading-tight text-txt">{title}</h3>
            {count !== undefined && <span className="rounded-full bg-wash px-2 py-0.5 font-mono text-[11px] font-bold text-dim">{count}</span>}
          </div>
          {sub && <div className="truncate text-[11px] text-faint">{sub}</div>}
        </div>
      </div>
      {right}
    </div>
  );
}

/** Intestazione di sezione di pagina (titolo forte + contatore + azioni). */
export function SectionHead({ title, right, children }: { title: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="font-display text-lg font-bold text-txt">{title}</h2>
      {children}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

/** Tessera KPI: icona tinta, etichetta piccola maiuscola, numero grande, barra opzionale. */
export function KpiTile({ label, value, color, valueColor, hint, bar, small, onClick, active }: {
  label: string; value: string; color: string; valueColor?: string; icon?: string; hint?: ReactNode;
  bar?: { pct: number; color?: string }; small?: boolean; onClick?: () => void; active?: boolean;
}) {
  const cls = `anim-in rounded-2xl border bg-surface p-4 shadow-sm transition hover:shadow-md ${active ? "border-focus ring-2 ring-[color:var(--focus)]" : "border-line hover:border-focus"} ${onClick ? "cursor-pointer text-left" : ""}`;
  const inner = (
    <>
      {/* Nessuna icona: etichetta e numero, come nella dashboard attuale (l'icona resta nel tipo per compatibilità) */}
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-dim">{label}</div>
        {onClick && <span className="shrink-0 text-faint"><Icon name={active ? "eye" : "chevron"} size={13} /></span>}
      </div>
      <div className={`mt-1 font-mono font-bold tabular-nums ${small ? "text-lg" : "text-2xl"}`} style={{ color: valueColor ?? color }}>{value}</div>
      {bar && <Bar pct={bar.pct} color={bar.color ?? color} className="mt-2.5" />}
      {hint && <div className="mt-1.5 text-[11px] text-faint">{hint}</div>}
    </>
  );
  return onClick ? <button onClick={onClick} className={`${cls} w-full`}>{inner}</button> : <div className={cls}>{inner}</div>;
}

/** Targa camera: numero su fondo tenue del colore della tipologia. Volutamente leggera: la scheda con foto resta solo in Prenotazioni e Calendario. */
export function RoomThumb({ unitId, roomTypeId, structureId, className = "" }: {
  unitId?: string; roomTypeId?: string; structureId?: string; className?: string; compact?: boolean; overlayStructure?: boolean;
}) {
  const { units, roomTypes, getStructure } = useData();
  const unit = units.find((u) => u.id === unitId);
  const rt = roomTypes.find((r) => r.id === (unit?.roomTypeId ?? roomTypeId));
  const st = getStructure(structureId ?? unit?.structureId ?? "");
  const col = rt?.color || st?.photoColor || "var(--focus)";
  const num = unit ? unit.name.replace(/^camera\s*/i, "") : null;
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden ${className}`} title={rt?.name ?? undefined} style={{ background: tint(col, 16), color: col }}>
      <span className="truncate px-1 text-sm font-bold leading-none">{num ?? "—"}</span>
    </div>
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

/** Intestazione di gruppo per struttura (nome, colore identità, contatore). */
export function StructureLabel({ name, color, count }: { name?: string; color?: string; count: number }) {
  const col = color ?? "var(--faint)";
  return (
    <div className="flex items-center gap-2 px-1 pb-1.5 pt-0.5">
      <span className="h-3 w-3 shrink-0 rounded-md" style={{ backgroundColor: col }} />
      <span className="truncate text-xs font-bold uppercase tracking-wide" style={{ color: color ?? "var(--dim)" }}>{name}</span>
      <span className="font-mono text-[11px] text-faint">· {count}</span>
    </div>
  );
}
