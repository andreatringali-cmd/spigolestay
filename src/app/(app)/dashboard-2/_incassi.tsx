"use client";

// Ricavi del mese (per competenza, cioè per notte): numero grande, curva cumulata col mese scorso, maturati e da vivere.
import { cumulative, type MonthStats } from "@/lib/dashboard2";
import { num } from "@/lib/format";
import { tint } from "../_ui";
import { CountUp, Tile, TileHead, ThinBar, MoreLink, useEnter } from "./_kit";

const W = 300, H = 88, PAD = 8;

export default function Incassi({ monthName, prevName, cur, prev, todayIdx, delay = 0 }: { monthName: string; prevName: string; cur: MonthStats; prev: MonthStats; todayIdx: number; delay?: number }) {
  const { on, reduced } = useEnter();
  const n = cur.daily.length;
  const cc = cumulative(cur.daily), pc = cumulative(prev.daily);
  const max = Math.max(cc[n - 1] ?? 0, pc[pc.length - 1] ?? 0, 1);
  const x = (i: number, len: number) => (len <= 1 ? 0 : (i / (len - 1)) * W);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const path = (xs: number[], from: number, to: number) => xs.slice(from, to + 1).map((v, k) => `${k === 0 ? "M" : "L"}${x(from + k, xs.length).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ti = Math.max(0, Math.min(n - 1, todayIdx));
  const earnedPath = path(cc, 0, Math.max(0, ti));
  const area = `${earnedPath} L${x(ti, n).toFixed(1)},${H - PAD} L0,${H - PAD} Z`;
  const delta = prev.total > 0 ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null;
  const dColor = delta === null ? "" : delta >= 0 ? "var(--ok)" : "var(--err)";
  const hasData = cur.total > 0 || prev.total > 0;
  return (
    <Tile label={`Ricavi di ${monthName}`} delay={delay} className="flex flex-col">
      <TileHead title={`Ricavi di ${monthName}`} sub="Notti vissute e già prenotate" right={<MoreLink href="/statistiche">Statistiche</MoreLink>} />
      {!hasData ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-faint">Nessun ricavo registrato per questo mese.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="font-display text-[2.1rem] font-bold leading-none tabular-nums text-txt sm:text-4xl">€ <CountUp value={cur.total} format={(v) => num(v)} duration={1100} delay={150} /></div>
            {delta !== null && (
              <span className="mb-0.5 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: tint(dColor, 14), color: dColor }}>{delta >= 0 ? "+" : "−"}{Math.abs(delta)}% su {prevName}</span>
            )}
          </div>
          <div className="relative mt-4" role="img" aria-label={`Andamento cumulato dei ricavi di ${monthName} confrontato con ${prevName}`}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full overflow-visible" aria-hidden style={{ clipPath: on || reduced ? "inset(-6px 0 -6px 0)" : "inset(-6px 100% -6px 0)", transition: reduced ? "none" : "clip-path 1.2s cubic-bezier(.22,1,.36,1) .25s" }}>
              <defs>
                <linearGradient id="d2-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--focus)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--focus)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" x2={W} y1={H - PAD} y2={H - PAD} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {pc.length > 1 && <path d={path(pc, 0, pc.length - 1)} fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.7" />}
              {ti < n - 1 && <path d={path(cc, ti, n - 1)} fill="none" stroke="var(--focus)" strokeWidth="2" strokeDasharray="1 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.6" />}
              <path d={area} fill="url(#d2-area)" />
              <path d={earnedPath} fill="none" stroke="var(--focus)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${(x(ti, n) / W) * 100}%`, top: `${(y(cc[ti] ?? 0) / H) * 100}%`, backgroundColor: "var(--focus)", boxShadow: `0 0 0 4px ${tint("var(--focus)", 22)}`, opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity .4s ease 1.2s" }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-faint"><span>1</span><span>oggi {ti + 1}</span><span>{n}</span></div>
          <div className="mt-4">
            <ThinBar pct={cur.total ? (cur.earned / cur.total) * 100 : 0} color="var(--focus)" delay={300} />
            <div className="mt-2 flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-dim"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--focus)" }} />Maturati <strong className="font-mono text-txt">€ {num(cur.earned)}</strong></span>
              <span className="flex min-w-0 items-center gap-1.5 text-dim"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tint("var(--focus)", 30) }} />Da vivere <strong className="font-mono text-txt">€ {num(cur.ahead)}</strong></span>
            </div>
          </div>
        </>
      )}
    </Tile>
  );
}
