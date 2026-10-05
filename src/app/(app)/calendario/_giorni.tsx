"use client";

// Striscia dei giorni della vista Calendario · Dettagliato: 7 giorni navigabili con i contatori di ciascuno.
import type { ReactNode } from "react";
import DateField from "@/components/DateField";
import { parseISO } from "@/lib/dates";
import type { DayStats } from "./_modello";

export type Modo = "day" | "week";

type Kind = "arr" | "dep" | "stay" | "free" | "clean";
const MOVES: { key: Kind; color: string; name: (n: number) => string }[] = [
  { key: "arr", color: "var(--ok)", name: (n) => (n === 1 ? "arrivo" : "arrivi") },
  { key: "dep", color: "var(--warn)", name: (n) => (n === 1 ? "partenza" : "partenze") },
  { key: "stay", color: "var(--focus)", name: () => "in casa" },
];
const svgP = { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function KindIcon({ k }: { k: Kind }): ReactNode {
  if (k === "arr") return <svg {...svgP}><path d="M20 4v16" /><path d="M4 12h12" /><path d="M12 8l4 4-4 4" /></svg>;
  if (k === "dep") return <svg {...svgP}><path d="M4 4v16" /><path d="M8 12h12" /><path d="M16 8l4 4-4 4" /></svg>;
  if (k === "stay") return <svg {...svgP} fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>;
  if (k === "free") return <svg {...svgP}><circle cx="12" cy="12" r="6" /></svg>;
  return <svg {...svgP}><path d="M20 4L9.5 14.5" /><path d="M13 8l3 3" /><path d="M9.5 14.5l-4.5 1 -1 4.5 4.5 -1 4.5 -1 -3.5 -3.5z" /></svg>;
}

const valueOf = (s: DayStats, k: Kind) => k === "arr" ? s.arrivals : k === "dep" ? s.departures : k === "stay" ? s.stay : k === "free" ? s.free : s.clean;

export default function StriscaGiorni({ days, sel, mode, today, rangeLabel, onSelect, onShift, onToday, onMode, onPick }: {
  days: { iso: string; stats: DayStats }[];
  sel: string;
  mode: Modo;
  today: string;
  rangeLabel: string;
  onSelect: (iso: string) => void;
  onShift: (dir: -1 | 1) => void;
  onToday: () => void;
  onMode: (m: Modo) => void;
  onPick: (iso: string) => void;
}) {
  const atToday = days[0]?.iso === today && (mode === "week" || sel === today);
  const nav = "grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-dim transition hover:border-focus hover:text-focus";
  return (
    <div className="rounded-2xl border border-line p-3 shadow-sm sm:p-4" style={{ background: "color-mix(in srgb, var(--wash) 70%, var(--surface))" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
        <div className="inline-flex items-center gap-1">
          <button onClick={() => onShift(-1)} className={nav} aria-label="7 giorni indietro" title="7 giorni indietro">‹</button>
          <button onClick={() => onShift(1)} className={nav} aria-label="7 giorni avanti" title="7 giorni avanti">›</button>
        </div>
        <button onClick={onToday} disabled={atToday} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-txt transition hover:border-focus hover:text-focus disabled:opacity-50">Oggi</button>
        <div className="min-w-0 flex-1 truncate font-display text-base font-bold capitalize text-txt sm:text-lg">{rangeLabel}</div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-line bg-surface p-0.5 text-xs font-semibold" role="group" aria-label="Periodo mostrato">
            {([["day", "Giorno"], ["week", "7 giorni"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => onMode(k)} aria-pressed={mode === k} className={`rounded-md px-2.5 py-1.5 transition ${mode === k ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{l}</button>
            ))}
          </div>
          <DateField value={sel} onChange={(v) => { if (v) onPick(v); }} title="Vai alla data" className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm transition hover:border-focus" />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {days.map(({ iso, stats }) => {
          const d = parseISO(iso);
          const isToday = iso === today;
          const isSel = mode === "day" && iso === sel;
          const inRange = mode === "week";
          const wk = d.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", "");
          const mon = d.toLocaleDateString("it-IT", { month: "short" }).replace(".", "");
          return (
            <button
              key={iso} onClick={() => onSelect(iso)} aria-pressed={isSel} aria-current={isToday ? "date" : undefined}
              title={d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
              className={`flex min-w-0 flex-col items-stretch gap-1 rounded-xl border px-1 py-1.5 text-center transition sm:px-2 sm:py-2 ${isSel ? "border-focus shadow-md ring-1 ring-[color:var(--focus)]" : "border-line shadow-sm hover:border-focus"}`}
              style={isSel ? { background: "color-mix(in srgb, var(--focus) 14%, var(--surface))" } : { background: d.getDay() === 0 || d.getDay() === 6 ? "color-mix(in srgb, var(--wash) 45%, var(--surface))" : "var(--surface)" }}
            >
              <span className="block truncate text-[10px] font-semibold uppercase tracking-wide" style={{ color: d.getDay() === 0 ? "var(--err)" : d.getDay() === 6 ? "var(--warn)" : "var(--faint)" }}>{wk}</span>
              <span className="mx-auto grid h-7 min-w-7 place-items-center rounded-full px-1 font-mono text-sm font-bold tabular-nums sm:h-8 sm:min-w-8 sm:text-base" style={isToday ? { background: "var(--focus)", color: "#fff" } : { color: "var(--txt)" }}>{d.getDate()}</span>
              <span className="block truncate text-[10px] text-faint">{d.getDate() === 1 || iso === days[0].iso ? mon : " "}</span>
              {/* Movimenti del giorno: solo quelli che ci sono, con il nome per esteso (icona e numero stanno insieme) */}
              <span className="mt-1 flex min-h-[3.4rem] flex-col items-stretch justify-start gap-1">
                {MOVES.filter((k) => valueOf(stats, k.key) > 0).map((k) => {
                  const v = valueOf(stats, k.key);
                  return (
                    <span key={k.key} className="inline-flex items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums sm:px-2 sm:text-xs" style={{ color: k.color, background: `color-mix(in srgb, ${k.color} 14%, transparent)` }} title={`${v} ${k.name(v)}`}>
                      <KindIcon k={k.key} />
                      <span>{v}</span>
                      <span className="hidden sm:inline">{k.name(v)}</span>
                    </span>
                  );
                })}
                {stats.closed > 0 && (
                  <span className="inline-flex items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums sm:px-2 sm:text-xs" style={{ color: "var(--dim)", background: "color-mix(in srgb, var(--faint) 22%, transparent)" }} title={`${stats.closed} ${stats.closed === 1 ? "camera chiusa o fuori servizio" : "camere chiuse o fuori servizio"}`}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                    <span>{stats.closed}</span><span className="hidden sm:inline">{stats.closed === 1 ? "chiusa" : "chiuse"}</span>
                  </span>
                )}
                {MOVES.every((k) => valueOf(stats, k.key) === 0) && stats.closed === 0 && <span className="py-1 text-[11px] text-faint">Nessun movimento</span>}
              </span>
              {(() => {
                const occ = stats.totalUnits > 0 ? Math.round(((stats.totalUnits - stats.free) / stats.totalUnits) * 100) : 0;
                return (
                  <span className="mt-1 block border-t border-line pt-1.5" title={`Camere occupate nella notte: ${stats.totalUnits - stats.free} su ${stats.totalUnits} (${occ}%) · Pulizie${stats.cleanDone > 0 ? ` fatte ${stats.cleanDone} su ${stats.clean}` : `: ${stats.clean}`}`}>
                    <span className="mb-1.5 block h-1.5 overflow-hidden rounded-full bg-wash"><span className="block h-full rounded-full" style={{ width: `${occ}%`, background: occ >= 100 ? "var(--ok)" : "var(--focus)" }} /></span>
                    <span className="flex items-center justify-between gap-1 text-[10px] text-faint sm:text-[11px]">
                      <span className="truncate"><b className="font-semibold text-dim">{stats.free}</b> libere</span>
                      <span className="inline-flex shrink-0 items-center gap-0.5"><KindIcon k="clean" /><b className="font-semibold text-dim">{stats.cleanDone > 0 ? `${stats.cleanDone}/${stats.clean}` : stats.clean}</b></span>
                    </span>
                  </span>
                );
              })()}
            </button>
          );
        })}
      </div>

    </div>
  );
}
