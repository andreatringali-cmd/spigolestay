import type { Channel } from "@/lib/types";
import { CHANNELS } from "@/lib/types";
import ChannelLogo from "@/components/ChannelLogo";

export interface StackedBar { label: string; segs: { channel: Channel; value: number }[] }

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace(".", ",")}k` : String(Math.round(n)));
const niceCeil = (v: number) => {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
};

// Colonne impilate per canale: ogni colonna è divisa nei colori delle OTA (Booking blu, Airbnb rosa, Expedia giallo, diretta verde…),
// con la legenda a loghi sotto. Stessa impostazione di ColumnChart (assi, griglia, entrata animata).
export default function StackedColumns({ bars, height = 132, barWidth = 26, format = (n) => String(n) }: { bars: StackedBar[]; height?: number; barWidth?: number; format?: (n: number) => string }) {
  const totals = bars.map((b) => b.segs.reduce((a, s) => a + s.value, 0));
  const top = niceCeil(Math.max(1, ...totals));
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => f * top);
  const everyX = bars.length > 10 ? 2 : 1;
  // Canali presenti, nell'ordine dei canali di Xenora, per la legenda.
  const present = (Object.keys(CHANNELS) as Channel[]).filter((c) => bars.some((b) => b.segs.some((s) => s.channel === c && s.value > 0)));
  if (!bars.length) return <div className="py-6 text-center text-sm text-faint">Nessun dato nel periodo</div>;

  return (
    <div className="flex flex-1 flex-col pt-1">
      <div className="flex gap-2">
        <div className="flex w-8 shrink-0 flex-col justify-between py-[1px] text-right font-mono text-[9px] tabular-nums text-faint" style={{ height }}>
          {ticks.map((t, i) => (<span key={i} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">{compact(t)}</span>))}
        </div>
        <div className="relative flex-1" style={{ height }}>
          {ticks.map((t, i) => (
            <div key={i} className="absolute inset-x-0" style={{ bottom: `${(t / top) * 100}%`, height: 1, backgroundColor: i === ticks.length - 1 ? "var(--line)" : "color-mix(in srgb, var(--line) 60%, transparent)" }} />
          ))}
          <div className="absolute inset-0 flex items-end justify-between gap-[6px]">
            {bars.map((b, i) => {
              const total = totals[i];
              const tip = `${b.label}: ${format(total)}` + b.segs.filter((s) => s.value > 0).map((s) => `\n${CHANNELS[s.channel].label}: ${format(s.value)}`).join("");
              return (
                <div key={i} className="flex h-full min-w-0 flex-1 items-end justify-center" title={tip}>
                  <div
                    className="mx-auto flex w-full flex-col-reverse overflow-hidden rounded-t-[3px]"
                    style={{ maxWidth: barWidth, height: `${(total / top) * 100}%`, minHeight: total > 0 ? 2 : 0, transformOrigin: "bottom", animation: "growY 0.7s cubic-bezier(0.22, 1, 0.36, 1) both", animationDelay: `${i * 0.04}s` }}
                  >
                    {b.segs.filter((s) => s.value > 0).map((s) => (
                      <div key={s.channel} style={{ height: `${(s.value / total) * 100}%`, backgroundColor: `var(${CHANNELS[s.channel].cssVar})`, borderTop: "1px solid color-mix(in srgb, var(--surface) 70%, transparent)" }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mb-2 mt-1.5 flex gap-2">
        <div className="w-8 shrink-0" />
        <div className="flex flex-1 justify-between gap-[6px]">
          {bars.map((b, i) => (
            <div key={i} className="flex min-w-0 flex-1 flex-col items-center text-center leading-none text-faint"><span className="text-[9px]">{i % everyX === 0 ? b.label : ""}</span></div>
          ))}
        </div>
      </div>
      {present.length > 1 && (
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[10px] text-dim">
          {present.map((c) => (<span key={c} className="inline-flex items-center gap-1"><ChannelLogo channel={c} size={14} />{CHANNELS[c].label}</span>))}
        </div>
      )}
    </div>
  );
}
