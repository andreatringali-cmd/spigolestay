"use client";

// Occupazione: ultimi 30 giorni (smeraldo) e prossimi 30 (indaco) in un solo grafico ad area, con fascia weekend, linea "oggi" e tooltip.
import { type DayCell } from "@/lib/dashboard2";
import { tint } from "../_ui";
import { CountUp, P, Tile, TileHead, Tip, useChartHover, useEnter } from "./_kit";

const WD_LONG = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const dayOf = (iso: string) => Number(iso.slice(8, 10));
const monthOf = (iso: string) => MESI[Number(iso.slice(5, 7)) - 1];
const W = 600, H = 132, PAD = 8;

export default function Giorni({ cells, delay = 0 }: { cells: DayCell[]; delay?: number }) {
  const { on, reduced } = useEnter();
  const n = cells.length;
  const { idx, bind } = useChartHover(n, "point");
  const ti = Math.max(0, cells.findIndex((c) => c.isToday));
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (pct: number) => H - PAD - (Math.min(100, Math.max(0, pct)) / 100) * (H - PAD * 2);
  const line = (a: number, b: number) => cells.slice(a, b + 1).map((c, k) => `${k === 0 ? "M" : "L"}${x(a + k).toFixed(1)},${y(c.pct).toFixed(1)}`).join(" ");
  const area = (a: number, b: number) => `${line(a, b)} L${x(b).toFixed(1)},${H - PAD} L${x(a).toFixed(1)},${H - PAD} Z`;
  const avg = (a: number, b: number) => { const l = cells.slice(a, b).filter((c) => c.total > 0); return l.length ? Math.round(l.reduce((s, c) => s + c.pct, 0) / l.length) : 0; };
  const past = avg(0, ti), next = avg(ti + 1, n);
  const hc = idx !== null ? cells[idx] : null;
  const hasRooms = cells.some((c) => c.total > 0);
  return (
    <Tile label="Occupazione" delay={delay}>
      <TileHead
        title="Occupazione"
        right={hasRooms ? (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold">
            <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: tint(P.cy, 14), color: P.cy }} title="Media degli ultimi 30 giorni">30g · <CountUp value={past} format={(v) => `${Math.round(v)}%`} /></span>
            <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: tint(P.vi, 14), color: P.vi }} title="Media dei prossimi 30 giorni">+30g · <CountUp value={next} format={(v) => `${Math.round(v)}%`} /></span>
          </div>
        ) : null}
      />
      {!hasRooms ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-faint">Nessuna camera configurata.</div>
      ) : (
        <>
          <div className="relative" {...bind} role="img" aria-label={`Occupazione degli ultimi 30 e dei prossimi 30 giorni. Media passata ${past}%, prevista ${next}%.`}>
            <div style={{ clipPath: on || reduced ? "inset(-8px 0 -8px 0)" : "inset(-8px 100% -8px 0)", transition: reduced ? "none" : "clip-path 1.4s cubic-bezier(.22,1,.36,1) .15s" }}>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-32 w-full overflow-visible sm:h-36" aria-hidden>
                <defs>
                  <linearGradient id="d2-occ-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--d2-cy)" stopOpacity=".34" /><stop offset="100%" stopColor="var(--d2-cy)" stopOpacity="0" /></linearGradient>
                  <linearGradient id="d2-occ-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--d2-vi)" stopOpacity=".3" /><stop offset="100%" stopColor="var(--d2-vi)" stopOpacity="0" /></linearGradient>
                </defs>
                {cells.map((c, i) => (c.dow === 0 || c.dow === 6) && (
                  <rect key={c.iso} x={x(i) - W / (n - 1) / 2} y={PAD / 2} width={W / (n - 1)} height={H - PAD} fill="var(--faint)" opacity=".1" />
                ))}
                {[50, 100].map((g) => <line key={g} x1="0" x2={W} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />)}
                <path d={area(0, ti)} fill="url(#d2-occ-p)" />
                <path d={area(ti, n - 1)} fill="url(#d2-occ-f)" />
                <path d={line(0, ti)} fill="none" stroke="var(--d2-cy)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                <path d={line(ti, n - 1)} fill="none" stroke="var(--d2-vi)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                <line x1={x(ti)} x2={x(ti)} y1={PAD / 2} y2={H - PAD / 2} stroke="var(--txt)" strokeWidth="1" strokeDasharray="3 3" opacity=".45" vectorEffect="non-scaling-stroke" />
                {hc && <line x1={x(idx!)} x2={x(idx!)} y1={PAD / 2} y2={H - PAD / 2} stroke="var(--txt)" strokeWidth="1" opacity=".35" vectorEffect="non-scaling-stroke" />}
              </svg>
            </div>
            <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${(x(ti) / W) * 100}%`, top: `${(y(cells[ti]?.pct ?? 0) / H) * 100}%`, backgroundColor: "var(--txt)", boxShadow: `0 0 0 4px ${tint("var(--txt)", 14)}`, opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity .4s ease 1.2s" }} />
            {hc && <span className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: `${(x(idx!) / W) * 100}%`, top: `${(y(hc.pct) / H) * 100}%`, backgroundColor: "var(--surface)", borderColor: idx! <= ti ? "var(--d2-cy)" : "var(--d2-vi)" }} />}
            {hc && (
              <Tip xPct={(x(idx!) / W) * 100}>
                <div className="font-semibold">{WD_LONG[hc.dow]} {dayOf(hc.iso)} {monthOf(hc.iso)}{hc.isToday ? " · oggi" : ""}</div>
                <div className="mt-0.5 font-mono"><strong>{hc.pct}%</strong> <span className="text-faint">· {hc.occupied}/{hc.total} camere</span></div>
                <div className="mt-0.5"><span style={{ color: "var(--ok)" }}>+{hc.arrivals}</span> <span style={{ color: "var(--err)" }}>−{hc.departures}</span></div>
              </Tip>
            )}
          </div>
          <div className="relative mt-1.5 flex justify-between text-[10px] text-faint">
            <span>{dayOf(cells[0].iso)} {monthOf(cells[0].iso)}</span>
            <span className="font-semibold text-dim">oggi</span>
            <span>{dayOf(cells[n - 1].iso)} {monthOf(cells[n - 1].iso)}</span>
          </div>
        </>
      )}
    </Tile>
  );
}
