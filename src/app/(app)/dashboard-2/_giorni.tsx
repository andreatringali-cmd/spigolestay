"use client";

// Prossimi 14 giorni: una colonna per notte, alta quanto l'occupazione; sopra gli arrivi (verde) e le partenze (rosso).
import { type DayCell } from "@/lib/dashboard2";
import { tint } from "../_ui";
import { MoreLink, Tile, TileHead, useEnter } from "./_kit";

const WD = ["D", "L", "M", "M", "G", "V", "S"];
const WD_LONG = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const dayOf = (iso: string) => Number(iso.slice(8, 10));
const monthOf = (iso: string) => MESI[Number(iso.slice(5, 7)) - 1];

export default function Giorni({ cells, delay = 0 }: { cells: DayCell[]; delay?: number }) {
  const { on, reduced } = useEnter();
  const withRooms = cells.filter((c) => c.total > 0);
  const avg = withRooms.length ? Math.round(withRooms.reduce((a, c) => a + c.pct, 0) / withRooms.length) : 0;
  const peak = withRooms.reduce<DayCell | null>((m, c) => (!m || c.pct > m.pct ? c : m), null);
  const arrTot = cells.reduce((a, c) => a + c.arrivals, 0);
  const depTot = cells.reduce((a, c) => a + c.departures, 0);
  return (
    <Tile label="Prossimi 14 giorni" delay={delay}>
      <TileHead
        title="Prossimi 14 giorni"
        sub={withRooms.length ? `Occupazione media ${avg}%${peak && peak.pct > 0 ? ` · picco ${peak.pct}% ${WD_LONG[peak.dow]} ${dayOf(peak.iso)} ${monthOf(peak.iso)}` : ""}` : "Nessuna camera configurata"}
        right={<MoreLink href="/calendario">Calendario</MoreLink>}
      />
      <ol className="grid gap-x-0.5 sm:gap-x-1.5" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map((c, i) => {
          const weekend = c.dow === 0 || c.dow === 6;
          const fill = tint("var(--focus)", Math.round(26 + c.pct * 0.42));
          return (
            <li
              key={c.iso} className="flex min-w-0 flex-col items-center gap-1"
              title={`${WD_LONG[c.dow]} ${dayOf(c.iso)} ${monthOf(c.iso)} · ${c.occupied}/${c.total} camere (${c.pct}%) · ${c.arrivals} arrivi · ${c.departures} partenze`}
              aria-label={`${WD_LONG[c.dow]} ${dayOf(c.iso)} ${monthOf(c.iso)}: ${c.pct}% occupate, ${c.arrivals} arrivi, ${c.departures} partenze`}
            >
              <div className="flex h-7 flex-col items-center justify-end text-[10px] font-bold leading-[1.15] tabular-nums">
                {c.arrivals > 0 && <span style={{ color: "var(--ok)" }}>+{c.arrivals}</span>}
                {c.departures > 0 && <span style={{ color: "var(--err)" }}>−{c.departures}</span>}
              </div>
              <div className="relative h-24 w-full max-w-[30px] overflow-hidden rounded-lg sm:h-28" style={{ backgroundColor: tint("var(--focus)", 8), outline: c.isToday ? "2px solid var(--focus)" : undefined, outlineOffset: 1 }}>
                <div
                  className="absolute inset-x-0 bottom-0 origin-bottom rounded-lg"
                  style={{ height: `${Math.max(c.pct > 0 ? 6 : 0, c.pct)}%`, backgroundColor: fill, transform: on ? "scaleY(1)" : "scaleY(0)", transition: reduced ? "none" : `transform .8s cubic-bezier(.22,1,.36,1) ${120 + i * 40}ms` }}
                />
              </div>
              <div className="flex flex-col items-center leading-none">
                <span className={`text-[10px] font-semibold ${weekend ? "text-txt" : "text-faint"}`}>{WD[c.dow]}</span>
                <span className="mt-1 grid h-[18px] min-w-[18px] place-items-center rounded-full text-[10px] font-bold tabular-nums sm:h-5 sm:min-w-5 sm:px-1 sm:text-[11px]" style={c.isToday ? { backgroundColor: "var(--focus)", color: "var(--surface)" } : { color: weekend ? "var(--txt)" : "var(--dim)" }}>{dayOf(c.iso)}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        <span className="flex items-center gap-1.5"><span className="font-bold" style={{ color: "var(--ok)" }}>+n</span> arrivi ({arrTot})</span>
        <span className="flex items-center gap-1.5"><span className="font-bold" style={{ color: "var(--err)" }}>−n</span> partenze ({depTot})</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: tint("var(--focus)", 55) }} />altezza = camere occupate</span>
      </div>
    </Tile>
  );
}
