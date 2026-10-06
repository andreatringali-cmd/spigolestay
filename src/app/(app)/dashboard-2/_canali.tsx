"use client";

// Canali: da dove arrivano i ricavi del mese, con barre sottili.
import ChannelLogo from "@/components/ChannelLogo";
import type { Channel } from "@/lib/types";
import { num } from "@/lib/format";
import { MoreLink, Tile, TileHead, ThinBar } from "./_kit";

export interface ChannelRow { channel: Channel; label: string; color: string; revenue: number; count: number; share: number }

export default function Canali({ rows, monthName, delay = 0 }: { rows: ChannelRow[]; monthName: string; delay?: number }) {
  const top = rows[0]?.revenue || 1;
  return (
    <Tile label="Canali" delay={delay}>
      <TileHead title="Canali" sub={`Ricavi di ${monthName} per provenienza`} right={<MoreLink href="/canali">Gestisci</MoreLink>} />
      <ul className="flex flex-col gap-3.5">
        {rows.map((r, i) => (
          <li key={r.channel} className="flex items-center gap-3">
            <ChannelLogo channel={r.channel} size={24} title={r.label} />
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold text-txt">{r.label}</span>
                <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-txt">€ {num(r.revenue)}</span>
              </div>
              <ThinBar pct={(r.revenue / top) * 100} color={r.color} delay={150 + i * 90} />
              <div className="mt-1 text-[11px] text-faint">{r.share}% dei ricavi · {r.count} {r.count === 1 ? "prenotazione" : "prenotazioni"}</div>
            </div>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
