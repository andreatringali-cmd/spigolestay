"use client";

// Canali: quota dei ricavi di ogni canale (primi cinque) con barra sottile nel colore del portale, percentuale e importo.
import ChannelLogo from "@/components/ChannelLogo";
import type { Channel } from "@/lib/types";
import { eur } from "@/lib/format";
import { EmptyRow, HeadLink, Panel } from "./_kit";

// `name` (facoltativo): nome del portale quando il canale è generico ("other"): serve a riconoscere bb.it e mostrarne il logo invece di "Altro".
export interface ChannelRow { channel: Channel; label: string; color: string; revenue: number; count: number; share: number; name?: string }

export default function Canali({ rows }: { rows: ChannelRow[] }) {
  return (
    <Panel title="Canali" right={<HeadLink href="/canali">Gestisci</HeadLink>}>
      {rows.length === 0 ? (
        <EmptyRow action={<HeadLink href="/canali">Collega i canali</HeadLink>}>Nessun ricavo per canale.</EmptyRow>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.channel} className="flex min-h-9 items-center gap-2 px-3 py-1" title={`${r.label}: ${eur(r.revenue)} · ${r.count} ${r.count === 1 ? "prenotazione" : "prenotazioni"}`}>
              <ChannelLogo channel={r.channel} size={18} title={r.label} name={r.name} />
              <span className="w-24 shrink-0 truncate text-[13px] font-medium text-txt max-sm:w-20">{r.label}</span>
              <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-wash" aria-hidden><span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, r.share))}%`, backgroundColor: r.color }} /></span>
              <span className="w-9 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-txt">{r.share}%</span>
              <span className="w-[5.5rem] shrink-0 text-right font-mono text-xs tabular-nums text-dim">{eur(r.revenue)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
