// Grafico unico per canale/tipologia: UNA barra per riga (lunghezza = ricavi),
// con entrambi i valori a fianco (prenotazioni + ricavi). Altezza max ~2 righe, scroll verticale.
type Row = { label: string; color: string; count: number; revenue: number };

export default function ChannelBars({ rows, fmtEur }: { rows: Row[]; fmtEur: (n: number) => string }) {
  if (!rows.length) return <div className="py-6 text-center text-sm text-faint">Nessun dato nel periodo</div>;
  const maxR = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <div className="flex max-h-[210px] flex-col gap-3 overflow-y-auto pr-1 pt-1" style={{ scrollbarWidth: "thin" }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-txt"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} /><span className="truncate">{r.label}</span></span>
            <span className="shrink-0 font-mono text-dim"><b className="text-txt">{r.count}</b> pren · <b className="text-txt">{fmtEur(r.revenue)}</b></span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-wash">
            <div className="anim-grow h-full rounded-full" style={{ width: `${(r.revenue / maxR) * 100}%`, backgroundColor: r.color, transition: "width .7s cubic-bezier(0.22,1,0.36,1)", animationDelay: `${i * 0.08}s` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
