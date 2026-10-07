// Grafico unico per canale/tipologia: UNA barra per riga (lunghezza = ricavi),
// con entrambi i valori a fianco (prenotazioni + ricavi). Altezza max ~2 righe, scroll verticale.
import { CHANNELS, type Channel } from "@/lib/types";
import ChannelLogo from "@/components/ChannelLogo";

// `channel`: se presente, al posto del pallino colorato compare il logo della OTA.
// `parts`: ricavi e prenotazioni della riga divisi per canale; la barra si divide nei colori delle OTA.
type Part = { channel: Channel; count: number; revenue: number };
type Row = { label: string; color: string; count: number; revenue: number; channel?: Channel; parts?: Part[] };

export default function ChannelBars({ rows, fmtEur }: { rows: Row[]; fmtEur: (n: number) => string }) {
  if (!rows.length) return <div className="py-6 text-center text-sm text-faint">Nessun dato nel periodo</div>;
  const maxR = Math.max(1, ...rows.map((r) => r.revenue));
  const present = (Object.keys(CHANNELS) as Channel[]).filter((c) => rows.some((r) => r.parts?.some((p) => p.channel === c && (p.revenue > 0 || p.count > 0))));
  return (
    <div>
    <div className={`flex ${present.length > 0 ? "max-h-[180px]" : "max-h-[210px]"} flex-col gap-3 overflow-y-auto pr-1 pt-1`} style={{ scrollbarWidth: "thin" }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-txt">{r.channel ? <ChannelLogo channel={r.channel} size={18} /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />}<span className="truncate">{r.label}</span></span>
            <span className="shrink-0 font-mono text-dim"><b className="text-txt">{r.count}</b> pren · <b className="text-txt">{fmtEur(r.revenue)}</b></span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-wash">
            <div className="anim-grow flex h-full overflow-hidden rounded-full" style={{ width: `${(r.revenue / maxR) * 100}%`, backgroundColor: r.parts?.length ? undefined : r.color, transition: "width .7s cubic-bezier(0.22,1,0.36,1)", animationDelay: `${i * 0.08}s` }}>
              {r.parts?.filter((p) => p.revenue > 0).map((p) => (
                <div key={p.channel} className="h-full" title={`${CHANNELS[p.channel].label}: ${p.count} pren · ${fmtEur(p.revenue)}`} style={{ width: `${(p.revenue / Math.max(1, r.revenue)) * 100}%`, backgroundColor: `var(${CHANNELS[p.channel].cssVar})` }} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
      {present.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[10px] text-dim">
          {present.map((c) => (<span key={c} className="inline-flex items-center gap-1"><ChannelLogo channel={c} size={14} />{CHANNELS[c].label}</span>))}
        </div>
      )}
    </div>
  );
}
