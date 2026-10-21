"use client";

// Striscia dei giorni della vista Calendario · Dettagliato: 7 giorni navigabili con i contatori di ciascuno.
import type { ReactNode } from "react";
import { parseISO, fmtDM } from "@/lib/dates";
import type { DayStats } from "./_modello";

export type Modo = "day" | "week";

type Kind = "arr" | "dep" | "stay" | "free" | "clean";
const svgP = { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function KindIcon({ k }: { k: Kind }): ReactNode {
  if (k === "arr") return <svg {...svgP}><path d="M20 4v16" /><path d="M4 12h12" /><path d="M12 8l4 4-4 4" /></svg>;
  if (k === "dep") return <svg {...svgP}><path d="M4 4v16" /><path d="M8 12h12" /><path d="M16 8l4 4-4 4" /></svg>;
  if (k === "stay") return <svg {...svgP} fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>;
  if (k === "free") return <svg {...svgP}><circle cx="12" cy="12" r="6" /></svg>;
  return <svg {...svgP}><path d="M20 4L9.5 14.5" /><path d="M13 8l3 3" /><path d="M9.5 14.5l-4.5 1 -1 4.5 4.5 -1 4.5 -1 -3.5 -3.5z" /></svg>;
}


export default function StriscaGiorni({ days, sel, mode, today, rangeLabel, onSelect, onShift, onToday, phone, onStepDay }: {
  days: { iso: string; stats: DayStats }[];
  sel: string;
  mode: Modo;
  today: string;
  rangeLabel: string;
  onSelect: (iso: string) => void;
  onShift: (dir: -1 | 1) => void;
  onToday: () => void;
  /** Telefono: si vede UN giorno alla volta (quello scelto, di partenza oggi) con frecce ‹ › di un giorno, invece dei 7 giorni in colonne strettissime. */
  phone?: boolean;
  onStepDay?: (n: number) => void;
}) {
  if (phone && onStepDay) return <GiornoTelefono days={days} sel={sel} today={today} label={rangeLabel} onStep={onStepDay} onToday={onToday} />;
  const atToday = days[0]?.iso === today && (mode === "week" || sel === today);
  const nav = "grid h-8 w-8 max-sm:h-10 max-sm:w-10 place-items-center rounded-lg border border-line bg-surface text-dim transition hover:border-focus hover:text-focus";
  return (
    <div className="rounded-2xl border border-line p-3 shadow-sm sm:p-4" style={{ background: "color-mix(in srgb, var(--wash) 70%, var(--surface))" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
        <div className="inline-flex items-center gap-1">
          <button onClick={() => onShift(-1)} className={nav} aria-label="7 giorni indietro" title="7 giorni indietro">‹</button>
          <button onClick={() => onShift(1)} className={nav} aria-label="7 giorni avanti" title="7 giorni avanti">›</button>
        </div>
        <button onClick={onToday} disabled={atToday} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-txt transition hover:border-focus hover:text-focus disabled:opacity-50 max-sm:min-h-10">Oggi</button>
        <div className="min-w-0 flex-1 truncate font-display text-base font-bold capitalize text-txt sm:text-lg">{rangeLabel}</div>
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
              title={`${d.toLocaleDateString("it-IT", { weekday: "long" })} ${fmtDM(iso)}`}
              className={`flex min-w-0 flex-col items-stretch gap-1 rounded-xl border px-1 py-1.5 text-center transition sm:px-2 sm:py-2 ${isSel ? "border-focus shadow-md ring-1 ring-[color:var(--focus)]" : "border-line shadow-sm hover:border-focus"}`}
              style={isSel ? { background: "color-mix(in srgb, var(--focus) 14%, var(--surface))" } : { background: d.getDay() === 0 || d.getDay() === 6 ? "color-mix(in srgb, var(--wash) 45%, var(--surface))" : "var(--surface)" }}
            >
              <span className="block truncate text-[11px] font-semibold uppercase tracking-wide" style={{ color: d.getDay() === 0 ? "var(--err)" : d.getDay() === 6 ? "var(--warn)" : "var(--faint)" }}>{wk}</span>
              <span className={`mx-auto grid h-7 min-w-7 place-items-center rounded-full px-1 font-mono text-sm font-bold tabular-nums sm:h-8 sm:min-w-8 sm:text-base ${isToday ? "text-on-focus" : ""}`} style={isToday ? { background: "var(--focus)" } : { color: "var(--txt)" }}>{d.getDate()}</span>
              <span className="block truncate text-[11px] text-faint">{d.getDate() === 1 || iso === days[0].iso ? mon : " "}</span>
              <DayBody stats={stats} />
            </button>
          );
        })}
      </div>

    </div>
  );
}

// Contenuto di ogni giorno: arrivi e partenze in due blocchi affiancati, "in casa" sotto, barra di occupazione e camere libere.
const C = { arr: "var(--ok)", dep: "var(--err)", stay: "var(--focus)" };
const tint = (c: string, p = 15) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
function DayBody({ stats }: { stats: DayStats }) {
  const total = stats.totalUnits, free = stats.free;
  const occ = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  const barCol = free === 0 ? "var(--ok)" : "var(--focus)";
  return (<>
    <span className="mt-1 grid grid-cols-2 gap-1 max-xl:grid-cols-1">
      {([["arr", stats.arrivals, "arrivi"], ["dep", stats.departures, "partenze"]] as const).map(([k, n, lab]) => (
        <span key={k} className="rounded-lg py-1 max-xl:flex max-xl:items-center max-xl:justify-center max-xl:gap-0.5 max-xl:py-1.5" style={{ background: tint(C[k]) }} title={`${n} ${lab}`}>
          <span className="hidden max-xl:inline-flex" style={{ color: C[k] }}><KindIcon k={k} /></span>
          <span className="block font-mono text-lg font-bold leading-none tabular-nums max-xl:text-base" style={{ color: C[k] }}>{n}</span>
          <span className="block text-[11px] max-xl:hidden" style={{ color: C[k] }}>{lab}</span>
        </span>))}
    </span>
    <span className="mt-1 flex items-center justify-center gap-1 rounded-lg py-0.5 text-[12px] font-semibold tabular-nums" style={{ color: C.stay, background: tint(C.stay) }}><KindIcon k="stay" />{stats.stay}<span className="max-xl:hidden"> in casa</span></span>
    {stats.closed > 0 && <span className="mt-1 flex items-center justify-center gap-1 rounded-lg py-0.5 text-[11px] font-semibold text-dim" style={{ background: tint("var(--faint)", 22) }} title={`${stats.closed} ${stats.closed === 1 ? "camera chiusa o fuori servizio" : "camere chiuse o fuori servizio"}`}>{stats.closed}<span className="xl:hidden">ch.</span><span className="max-xl:hidden"> {stats.closed === 1 ? "chiusa" : "chiuse"}</span></span>}
    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-wash" title={`Camere occupate nella notte: ${total - free} su ${total} (${occ}%)`}><span className="block h-full rounded-full" style={{ width: `${occ}%`, background: barCol }} /></span>
    <span className="mt-1.5 flex items-center justify-between text-[11px] text-faint max-xl:flex-col max-xl:gap-0.5 max-xl:text-[11px]">
      <span className="whitespace-nowrap" style={free === 0 ? { color: "var(--err)", fontWeight: 600 } : undefined}>{free === 0 ? "0 libere" : `${free} ${free === 1 ? "libera" : "libere"}`}</span>
      <span className="inline-flex items-center gap-0.5" title={`Pulizie${stats.cleanDone > 0 ? ` fatte ${stats.cleanDone} su ${stats.clean}` : `: ${stats.clean}`}`}><KindIcon k="clean" /><b className="font-semibold text-dim">{stats.cleanDone > 0 ? `${stats.cleanDone}/${stats.clean}` : stats.clean}</b></span>
    </span>
  </>);
}

// Vista GIORNALIERA per telefono: il giorno scelto a tutta larghezza, con numeri grandi e leggibili (arrivi, partenze, in casa), occupazione, camere libere e pulizie.
function GiornoTelefono({ days, sel, today, label, onStep, onToday }: { days: { iso: string; stats: DayStats }[]; sel: string; today: string; label: string; onStep: (n: number) => void; onToday: () => void }) {
  const stats = days.find((d) => d.iso === sel)?.stats ?? days[0]?.stats;
  const nav = "grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-surface text-lg text-dim transition active:border-focus active:text-focus";
  if (!stats) return null;
  const total = stats.totalUnits, free = stats.free;
  const occ = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  const tile = (k: "arr" | "dep" | "stay", n: number, lab: string) => (
    <div className="flex flex-col items-center rounded-xl py-2.5" style={{ background: tint(C[k]) }}>
      <span className="font-mono text-3xl font-bold leading-none tabular-nums" style={{ color: C[k] }}>{n}</span>
      <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: C[k] }}><KindIcon k={k} />{lab}</span>
    </div>
  );
  return (
    <div className="rounded-2xl border border-line p-3 shadow-sm" style={{ background: "color-mix(in srgb, var(--wash) 70%, var(--surface))" }}>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => onStep(-1)} className={nav} aria-label="Giorno prima">‹</button>
        <button onClick={onToday} disabled={sel === today} className="min-w-0 flex-1 truncate rounded-lg px-1 text-center font-display text-base font-bold capitalize text-txt disabled:opacity-100" aria-label="Torna a oggi">{label}{sel === today ? <span className="ml-1.5 rounded-full bg-focus px-2 py-0.5 align-middle text-[11px] font-bold uppercase text-on-focus">Oggi</span> : <span className="ml-1.5 align-middle text-[11px] font-semibold text-focus">→ Oggi</span>}</button>
        <button onClick={() => onStep(1)} className={nav} aria-label="Giorno dopo">›</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tile("arr", stats.arrivals, "Arrivi")}
        {tile("dep", stats.departures, "Partenze")}
        {tile("stay", stats.stay, "In casa")}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="font-semibold" style={free === 0 ? { color: "var(--err)" } : { color: "var(--txt)" }}>{free === 0 ? "Nessuna camera libera" : `${free} ${free === 1 ? "camera libera" : "camere libere"} su ${total}`}</span>
        <span className="inline-flex items-center gap-1 text-faint" title="Pulizie"><KindIcon k="clean" /><b className="font-semibold text-dim">{stats.cleanDone > 0 ? `${stats.cleanDone}/${stats.clean}` : stats.clean}</b> pulizie</span>
      </div>
      <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-wash" title={`Camere occupate nella notte: ${total - free} su ${total} (${occ}%)`}><span className="block h-full rounded-full" style={{ width: `${occ}%`, background: free === 0 ? "var(--ok)" : "var(--focus)" }} /></span>
      {stats.closed > 0 && <div className="mt-1.5 text-[11px] text-dim">{stats.closed} {stats.closed === 1 ? "camera chiusa o fuori servizio" : "camere chiuse o fuori servizio"}</div>}
    </div>
  );
}
