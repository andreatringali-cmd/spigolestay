"use client";

// Occupazione dei prossimi 14 giorni: una fila di colonne (altezza = % di camere occupate), giorno della settimana e data sotto, picco e minimo in una riga.
// Il grafico è decorativo per i lettori di schermo: la stessa informazione sta in un elenco nascosto.
import { fmtDM } from "@/lib/dates";
import type { DayCell, OccupancyOutlook } from "@/lib/dashboard";
import { EmptyRow, HeadLink, Panel } from "./_kit";

const WD_INITIAL = ["D", "L", "M", "M", "G", "V", "S"];
const WD_SHORT = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const label = (c: DayCell) => `${WD_SHORT[c.dow]} ${fmtDM(c.iso)}${c.isToday ? " (oggi)" : ""}: ${c.pct}% (${c.occupied} su ${c.total} camere), ${c.arrivals} arrivi, ${c.departures} partenze`;

export default function Occupazione({ cells, outlook }: { cells: DayCell[]; outlook: OccupancyOutlook }) {
  const hasRooms = cells.some((c) => c.total > 0);
  return (
    <Panel
      title="Occupazione, 14 giorni"
      right={<>{hasRooms && <span title="Media sui prossimi 14 giorni">Media <b className="font-mono font-semibold tabular-nums text-txt">{outlook.avg}%</b></span>}<HeadLink href="/calendario">Calendario</HeadLink></>}
    >
      {!hasRooms ? (
        <EmptyRow action={<HeadLink href="/camere">Aggiungi camere</HeadLink>}>Nessuna camera configurata.</EmptyRow>
      ) : (
        <div className="px-3 pb-2.5 pt-3">
          <div aria-hidden className="relative">
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
            <div className="grid h-24 grid-cols-[repeat(14,minmax(0,1fr))] gap-1">
              {cells.map((c) => (
                <div key={c.iso} className="flex h-full items-end" title={label(c)}>
                  <div className={`w-full rounded-t-[3px] ${c.pct > 0 ? "bg-focus" : "bg-line-strong"}`} style={{ height: c.pct > 0 ? `${Math.max(c.pct, 4)}%` : 2 }} />
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1 text-center text-xs leading-4">
              {cells.map((c) => (
                <div key={c.iso} className={c.isToday ? "font-semibold text-txt" : c.dow === 0 || c.dow === 6 ? "text-txt" : "text-dim"}>
                  <div>{WD_INITIAL[c.dow]}</div>
                  <div className="tabular-nums">{c.iso.slice(8)}</div>
                </div>
              ))}
            </div>
          </div>
          <ul className="sr-only">{cells.map((c) => <li key={c.iso}>{label(c)}</li>)}</ul>
          {outlook.peak && outlook.low && (
            <p className="mt-2 text-xs text-dim">
              Più pieno {outlook.peak.pct}% il {fmtDM(outlook.peak.iso)} · più libero {outlook.low.pct}% il {fmtDM(outlook.low.iso)}
              {outlook.fullDays > 0 ? ` · ${outlook.fullDays} ${outlook.fullDays === 1 ? "giorno" : "giorni"} al completo` : ""}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
