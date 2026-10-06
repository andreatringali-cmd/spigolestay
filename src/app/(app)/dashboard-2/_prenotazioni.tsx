"use client";

// Anticipo e durata: due mini istogrammi (quanti giorni prima si prenota, quante notti si resta) sulle prenotazioni degli ultimi 12 mesi.
import { type Histo } from "@/lib/dashboard2";
import { Columns, CountUp, P, Tile, TileHead, Tip, useChartHover } from "./_kit";

function Mini({ title, unit, histo, color, delay, fmtAvg }: { title: string; unit: string; histo: Histo; color: string; delay: number; fmtAvg: (n: number) => string }) {
  const n = histo.labels.length;
  const { idx, bind } = useChartHover(n, "bin");
  const peak = histo.counts.indexOf(Math.max(...histo.counts));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-faint">{title}</span>
        <span className="font-display text-xl font-bold tabular-nums text-txt">{histo.avg !== null ? <CountUp value={histo.avg} format={fmtAvg} delay={delay} /> : "–"}<span className="ml-1 text-[11px] font-semibold text-faint">{unit}</span></span>
      </div>
      <div className="relative mt-2" {...bind} role="img" aria-label={`${title}: media ${histo.avg !== null ? fmtAvg(histo.avg) : "n.d."} ${unit}. Fascia più frequente: ${histo.labels[peak]}.`}>
        <Columns values={histo.counts} colors={color} height={56} gap={4} highlight={peak} hover={idx} delay={delay} />
        {idx !== null && (
          <Tip xPct={((idx + 0.5) / n) * 100}>
            <div className="font-semibold">{histo.labels[idx]} {unit.startsWith("g") ? "giorni" : "notti"}</div>
            <div className="font-mono"><strong>{histo.counts[idx]}</strong> <span className="text-faint">· {histo.total ? Math.round((histo.counts[idx] / histo.total) * 100) : 0}%</span></div>
          </Tip>
        )}
      </div>
      <div className="mt-1 grid text-center text-[10px] text-faint" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, columnGap: 4 }}>
        {histo.labels.map((l, i) => <span key={l} className={i === peak ? "font-bold text-dim" : ""}>{l}</span>)}
      </div>
    </div>
  );
}

export default function Prenotazioni({ lead, stay, delay = 0 }: { lead: Histo; stay: Histo; delay?: number }) {
  return (
    <Tile label="Anticipo e durata" delay={delay}>
      <TileHead title="Prenotazioni" sub="Anticipo e durata, 12 mesi" />
      <div className="grid gap-5 sm:grid-cols-2">
        {lead.total > 0 && <Mini title="Anticipo" unit="giorni" histo={lead} color={P.ind} delay={150} fmtAvg={(v) => String(Math.round(v))} />}
        {stay.total > 0 && <Mini title="Durata" unit="notti" histo={stay} color={P.amb} delay={250} fmtAvg={(v) => (Math.round(v * 10) / 10).toString().replace(".", ",")} />}
      </div>
    </Tile>
  );
}
