"use client";

// Striscia dei giorni della vista Calendario · Dettagliato: 7 giorni navigabili con i contatori di ciascuno.
import type { ReactNode } from "react";
import { parseISO } from "@/lib/dates";
import type { DayStats } from "./_modello";

export type Modo = "day" | "week";

type Kind = "arr" | "dep" | "stay" | "free" | "clean";
const MOVES: { key: Kind; color: string; name: (n: number) => string }[] = [
  { key: "arr", color: "var(--ok)", name: (n) => (n === 1 ? "arrivo" : "arrivi") },
  { key: "dep", color: "var(--warn)", name: (n) => (n === 1 ? "partenza" : "partenze") },
  { key: "stay", color: "var(--focus)", name: (n) => (n === 1 ? "resta" : "restano") },
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
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => onShift(-1)} className={nav} aria-label="7 giorni indietro" title="7 giorni indietro">‹</button>
        <button onClick={() => onShift(1)} className={nav} aria-label="7 giorni avanti" title="7 giorni avanti">›</button>
        <button onClick={onToday} disabled={atToday} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-txt transition hover:border-focus hover:text-focus disabled:opacity-50">Oggi</button>
        <div className="min-w-0 flex-1 truncate font-display text-sm font-bold text-txt sm:text-base">{rangeLabel}</div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-wash p-0.5" role="group" aria-label="Periodo mostrato">
            {([["day", "Giorno"], ["week", "7 giorni"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => onMode(k)} aria-pressed={mode === k} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${mode === k ? "bg-surface text-focus shadow-sm" : "text-dim hover:text-txt"}`}>{l}</button>
            ))}
          </div>
          <input type="date" value={sel} onChange={(e) => { if (e.target.value) onPick(e.target.value); }} aria-label="Vai alla data" title="Vai alla data" className="h-8 w-[118px] rounded-lg border border-line bg-paper px-1.5 text-xs text-txt outline-none focus:border-focus" />
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
              className={`flex min-w-0 flex-col items-stretch gap-1 rounded-xl border px-1 py-1.5 text-center transition sm:px-2 sm:py-2 ${isSel ? "border-focus shadow-sm" : inRange ? "border-line hover:border-focus" : "border-transparent hover:border-line hover:bg-wash"}`}
              style={isSel ? { background: "color-mix(in srgb, var(--focus) 12%, transparent)" } : inRange ? { background: "color-mix(in srgb, var(--focus) 5%, transparent)" } : undefined}
            >
              <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-faint">{wk}</span>
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
                {MOVES.every((k) => valueOf(stats, k.key) === 0) && <span className="py-1 text-[11px] text-faint">Nessun movimento</span>}
              </span>
              <span className="mt-1 block truncate border-t border-line pt-1.5 text-[10px] text-faint sm:text-[11px]" title={`Camere libere nella notte: ${stats.free} su ${stats.totalUnits} · Pulizie${stats.cleanDone > 0 ? ` fatte ${stats.cleanDone} su ${stats.clean}` : `: ${stats.clean}`}`}>
                <b className="font-semibold text-dim">{stats.free}</b> libere · <b className="font-semibold text-dim">{stats.cleanDone > 0 ? `${stats.cleanDone}/${stats.clean}` : stats.clean}</b> pulizie
              </span>
            </button>
          );
        })}
      </div>

    </div>
  );
}
