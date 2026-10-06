"use client";

// Ricavi del mese (per competenza, cioè per notte): numero grande, curva cumulata contro il mese scorso, ADR e RevPAR con mini-trend.
import { cumulative, type MonthStats } from "@/lib/dashboard";
import { num } from "@/lib/format";
import { tint } from "../_ui";
import { CountUp, MoreLink, P, Sparkline, ThinBar, Tile, TileHead, Tip, useChartHover, useEnter } from "./_kit";

const W = 300, H = 92, PAD = 8;
export interface RateTrend { avg: number; series: number[] }

export default function Incassi({ monthName, prevName, cur, prev, todayIdx, adr, revpar, delay = 0 }: {
  monthName: string; prevName: string; cur: MonthStats; prev: MonthStats; todayIdx: number; adr: RateTrend; revpar: RateTrend; delay?: number;
}) {
  const { on, reduced } = useEnter();
  const n = cur.daily.length;
  const { idx, bind } = useChartHover(n, "point");
  const cc = cumulative(cur.daily), pc = cumulative(prev.daily);
  const max = Math.max(cc[n - 1] ?? 0, pc[pc.length - 1] ?? 0, 1);
  const x = (i: number, len: number) => (len <= 1 ? 0 : (i / (len - 1)) * W);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const path = (xs: number[], from: number, to: number) => xs.slice(from, to + 1).map((v, k) => `${k === 0 ? "M" : "L"}${x(from + k, xs.length).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ti = Math.max(0, Math.min(n - 1, todayIdx));
  const earnedPath = path(cc, 0, ti);
  const area = `${earnedPath} L${x(ti, n).toFixed(1)},${H - PAD} L0,${H - PAD} Z`;
  const delta = prev.total > 0 ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null;
  const dColor = delta === null ? "" : delta >= 0 ? "var(--ok)" : P.cor;
  const hasData = cur.total > 0 || prev.total > 0;
  const hi = idx !== null ? Math.min(idx, n - 1) : null;
  return (
    <Tile label={`Ricavi di ${monthName}`} delay={delay} className="flex flex-col">
      <TileHead title="Ricavi" sub={monthName} right={<MoreLink href="/statistiche">Statistiche</MoreLink>} />
      {!hasData ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-faint">Nessun ricavo nel mese.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="font-display text-[2.1rem] font-bold leading-none tabular-nums text-txt sm:text-4xl">€ <CountUp value={cur.total} format={(v) => num(v)} duration={1100} delay={150} /></div>
            {delta !== null && <span className="mb-0.5 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: tint(dColor, 14), color: dColor }} title={`Contro ${prevName}: € ${num(prev.total)}`}>{delta >= 0 ? "+" : "−"}{Math.abs(delta)}%</span>}
          </div>
          <div className="relative mt-3" {...bind} role="img" aria-label={`Ricavi cumulati di ${monthName} a confronto con ${prevName}`}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-24 w-full overflow-visible" aria-hidden style={{ clipPath: on || reduced ? "inset(-6px 0 -6px 0)" : "inset(-6px 100% -6px 0)", transition: reduced ? "none" : "clip-path 1.2s cubic-bezier(.22,1,.36,1) .25s" }}>
              <defs>
                <linearGradient id="d2-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--d2-cy)" stopOpacity="0.3" /><stop offset="100%" stopColor="var(--d2-cy)" stopOpacity="0" /></linearGradient>
              <linearGradient id="d2-curve" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="var(--d2-cy)" /><stop offset="100%" stopColor="var(--d2-vi)" /></linearGradient>
              </defs>
              <line x1="0" x2={W} y1={H - PAD} y2={H - PAD} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {pc.length > 1 && <path d={path(pc, 0, pc.length - 1)} fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.75" />}
              {ti < n - 1 && <path d={path(cc, ti, n - 1)} fill="none" stroke="var(--d2-vi)" strokeWidth="2" strokeDasharray="1 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.8" />}
              <path d={area} fill="url(#d2-area)" />
              <path d={earnedPath} fill="none" stroke="url(#d2-curve)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {hi !== null && <line x1={x(hi, n)} x2={x(hi, n)} y1="0" y2={H - PAD} stroke="var(--txt)" strokeWidth="1" opacity=".35" vectorEffect="non-scaling-stroke" />}
            </svg>
            <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${(x(ti, n) / W) * 100}%`, top: `${(y(cc[ti] ?? 0) / H) * 100}%`, backgroundColor: "var(--d2-cy)", boxShadow: `0 0 0 4px ${tint(P.cy, 24)}`, opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity .4s ease 1.2s" }} />
            {hi !== null && (
              <Tip xPct={(x(hi, n) / W) * 100}>
                <div className="font-semibold">{hi + 1} {monthName.slice(0, 3)}{hi > ti ? " · previsto" : ""}</div>
                <div className="font-mono"><strong>€ {num(cc[hi] ?? 0)}</strong></div>
                {pc.length > 0 && <div className="font-mono text-faint">{prevName.slice(0, 3)} € {num(pc[Math.min(hi, pc.length - 1)] ?? 0)}</div>}
              </Tip>
            )}
          </div>
          <div className="mt-2.5">
            <ThinBar pct={cur.total ? (cur.earned / cur.total) * 100 : 0} color={P.cy} delay={300} />
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-dim">
              <span className="flex min-w-0 items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: P.cy }} />Maturati <strong className="font-mono text-txt">€ {num(cur.earned)}</strong></span>
              <span className="flex min-w-0 items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tint(P.cy, 30) }} />Da vivere <strong className="font-mono text-txt">€ {num(cur.ahead)}</strong></span>
            </div>
          </div>
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            {([["ADR", adr, P.vi, "Prezzo medio a notte"], ["RevPAR", revpar, P.az, "Ricavo per camera disponibile"]] as const).map(([label, t, color, hint]) => (
              <div key={label} className="rounded-xl px-3 pb-2 pt-2" style={{ backgroundColor: tint(color, 9) }} title={`${hint} · ultimi 14 giorni`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color }}>{label}</span>
                  <span className="font-mono text-sm font-bold tabular-nums text-txt">€ <CountUp value={t.avg} format={(v) => num(v)} delay={300} /></span>
                </div>
                <div className="mt-1"><Sparkline values={t.series} color={color} h={22} strokeWidth={1.6} label={`${label}: ultimi 14 giorni`} /></div>
              </div>
            ))}
          </div>
        </>
      )}
    </Tile>
  );
}
