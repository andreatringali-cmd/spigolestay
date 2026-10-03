"use client";

// Primitive grafiche di Dashboard 2: stesso linguaggio visivo di "Prenotazioni · Dettagliata"
// (card rounded-2xl, intestazioni con contatore, pill/pallini tinti, anteprima camera, barre sottili).
// Qui non c'è logica di business: solo presentazione.
import type { CSSProperties, ReactNode } from "react";
import { useData } from "@/lib/store";
import Icon from "@/components/Icon";

/** Tinta morbida di un colore/token (sfondo di pill, tessere, icone). */
export const tint = (color: string, pct = 12) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export const daysFrom = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);

export const EYEBROW = "text-[10px] font-semibold uppercase tracking-[0.08em] text-faint";

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
            <h3 className="truncate font-display text-base font-bold leading-tight text-txt">{title}</h3>
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
      <h2 className="font-display text-xl font-bold tracking-tight text-txt">{title}</h2>
      {children}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

/** Tessera KPI: icona tinta, etichetta piccola maiuscola, numero grande, barra opzionale. */
export function KpiTile({ label, value, color, valueColor, icon, hint, bar, small, onClick, active }: {
  label: string; value: string; color: string; valueColor?: string; icon: string; hint?: ReactNode;
  bar?: { pct: number; color?: string }; small?: boolean; onClick?: () => void; active?: boolean;
}) {
  const cls = `anim-in rounded-2xl border bg-surface p-4 shadow-sm transition hover:shadow-md ${active ? "border-focus ring-2 ring-[color:var(--focus)]" : "border-line hover:border-focus"} ${onClick ? "cursor-pointer text-left" : ""}`;
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <IconTile icon={icon} color={color} />
        {onClick && <span className="text-faint"><Icon name={active ? "eye" : "chevron"} size={13} /></span>}
      </div>
      <div className={`mt-3 ${EYEBROW}`}>{label}</div>
      <div className={`mt-1 font-display font-extrabold leading-none tabular-nums ${small ? "text-2xl" : "text-3xl"}`} style={{ color: valueColor ?? color }}>{value}</div>
      {bar && <Bar pct={bar.pct} color={bar.color ?? color} className="mt-2.5" />}
      {hint && <div className="mt-1.5 text-[11px] text-faint">{hint}</div>}
    </>
  );
  return onClick ? <button onClick={onClick} className={`${cls} w-full`}>{inner}</button> : <div className={cls}>{inner}</div>;
}

/** Anteprima camera: foto (Unit.photos[0]) oppure riquadro colorato col numero camera, come in Prenotazioni · Dettagliata. */
export function RoomThumb({ unitId, roomTypeId, structureId, className = "", compact = false, overlayStructure = false }: {
  unitId?: string; roomTypeId?: string; structureId?: string; className?: string; compact?: boolean; overlayStructure?: boolean;
}) {
  const { units, roomTypes, getStructure } = useData();
  const unit = units.find((u) => u.id === unitId);
  const rt = roomTypes.find((r) => r.id === (unit?.roomTypeId ?? roomTypeId));
  const st = getStructure(structureId ?? unit?.structureId ?? "");
  const photo = unit?.photos?.[0];
  const col = rt?.color || st?.photoColor || "var(--focus)";
  const num = unit ? unit.name.replace(/^camera\s*/i, "") : null;
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-xl ${className}`} style={photo ? undefined : { background: `linear-gradient(145deg, color-mix(in srgb, ${col} 85%, #fff), color-mix(in srgb, ${col} 70%, #000))` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {compact ? (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/45 to-transparent text-white">
          <span className="truncate px-1 text-sm font-bold leading-none drop-shadow">{num ?? "—"}</span>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-6 text-white">
          <div className="truncate text-sm font-bold leading-tight">{num ?? <span className="italic">Da assegnare</span>}</div>
          {rt?.name && <div className="truncate text-[11px] opacity-90">{rt.name}</div>}
        </div>
      )}
      {overlayStructure && st && <span className="absolute left-1.5 top-1.5 max-w-[calc(100%-12px)] truncate rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white">{st.name}</span>}
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
      <span className="truncate text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: color ?? "var(--dim)" }}>{name}</span>
      <span className="font-mono text-[11px] text-faint">· {count}</span>
    </div>
  );
}
