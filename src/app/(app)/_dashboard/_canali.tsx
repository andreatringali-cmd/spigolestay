"use client";

// Canali: ciambella animata con le quote dei ricavi del mese e legenda corta. Passando sulla legenda o sugli spicchi si evidenzia il canale.
import { useState } from "react";
import ChannelLogo from "@/components/ChannelLogo";
import type { Channel } from "@/lib/types";
import { num } from "@/lib/format";
import { CountUp, MoreLink, SERIES, Tile, TileHead, useEnter } from "./_kit";

export interface ChannelRow { channel: Channel; label: string; color: string; revenue: number; count: number; share: number }

export default function Canali({ rows, total, monthName, delay = 0 }: { rows: ChannelRow[]; total: number; monthName: string; delay?: number }) {
  const { on, reduced } = useEnter();
  const [hi, setHi] = useState<number | null>(null);
  const sum = rows.reduce((a, r) => a + r.revenue, 0) || 1;
  const GAP = rows.length > 1 ? 1.4 : 0;
  const segs = rows.map((r, i) => {
    const start = (rows.slice(0, i).reduce((x, y) => x + y.revenue, 0) / sum) * 100;
    return { i, start, len: Math.max(0, (r.revenue / sum) * 100 - GAP) };
  });
  const h = hi !== null ? rows[hi] : null;
  return (
    <Tile label="Canali" delay={delay}>
      <TileHead title="Canali" sub={monthName} right={<MoreLink href="/canali">Gestisci</MoreLink>} />
      <div className="flex items-center gap-4">
        <div className="relative h-[116px] w-[116px] shrink-0 sm:h-[128px] sm:w-[128px]" role="img" aria-label={`Quote dei ricavi di ${monthName} per canale: ${rows.map((r) => `${r.label} ${r.share}%`).join(", ")}`}>
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r="38" fill="none" stroke="var(--wash)" strokeWidth="12" />
            {segs.map((s) => (
              <circle
                key={s.i} cx="50" cy="50" r="38" fill="none" stroke={SERIES[s.i % SERIES.length]} strokeWidth={hi === s.i ? 15 : 12} strokeLinecap="butt" pathLength={100}
                strokeDasharray={`${on ? s.len : 0} 100`} strokeDashoffset={-s.start} opacity={hi !== null && hi !== s.i ? 0.35 : 1}
                style={{ transition: reduced ? "none" : `stroke-dasharray 1s cubic-bezier(.22,1,.36,1) ${200 + s.i * 120}ms, stroke-width .2s, opacity .2s`, cursor: "pointer" }}
                onPointerEnter={() => setHi(s.i)} onPointerLeave={() => setHi(null)}
              />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            {h ? (
              <div><div className="font-display text-xl font-bold leading-none tabular-nums text-txt">{h.share}%</div><div className="mt-0.5 font-mono text-[10px] text-faint">€ {num(h.revenue)}</div></div>
            ) : (
              <div><div className="font-display text-base font-bold leading-none tabular-nums text-txt sm:text-lg">€ <CountUp value={total} format={(v) => num(v)} delay={300} /></div><div className="mt-0.5 text-[10px] text-faint">{rows.length} {rows.length === 1 ? "canale" : "canali"}</div></div>
            )}
          </div>
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-1">
          {rows.map((r, i) => (
            <li
              key={r.channel} onPointerEnter={() => setHi(i)} onPointerLeave={() => setHi(null)}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition" style={{ backgroundColor: hi === i ? "var(--wash)" : undefined, opacity: hi !== null && hi !== i ? 0.55 : 1 }}
              title={`${r.label}: € ${num(r.revenue)} · ${r.count} ${r.count === 1 ? "prenotazione" : "prenotazioni"}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: SERIES[i % SERIES.length] }} />
              <ChannelLogo channel={r.channel} size={18} title={r.label} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-txt">{r.label}</span>
              <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-txt">{r.share}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Tile>
  );
}
