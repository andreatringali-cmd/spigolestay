export interface ColumnBar {
  label: string;       // etichetta asse X (es. giorno)
  value: number;
  highlight?: boolean; // giorno selezionato / oggi
  color?: string;      // colore specifico della colonna (es. colore bandiera)
  fill?: string;       // riempimento completo (es. gradiente bandiera); ha priorità sul colore
  flag?: string;       // bandiera emoji da mostrare sotto la colonna (es. provenienza)
}

// Compattazione per le etichette dell'asse Y (es. 1500 → "1,5k").
const compact = (n: number) => {
  if (n >= 1000) { const s = (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace(".", ","); return `${s}k`; }
  return String(Math.round(n));
};

// Arrotonda per eccesso a un valore "tondo" per la scala dell'asse Y.
const niceCeil = (v: number) => {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
};

// Grafico a colonne verticali con assi X/Y e griglia (HTML/flex, testo nitido).
export default function ColumnChart({
  bars,
  color = "var(--focus)",
  format = (n) => String(n),
  height = 132,
  barWidth = 14,
  labelColor = "var(--faint)",
  allLabels = false,
}: {
  bars: ColumnBar[];
  color?: string;
  format?: (n: number) => string;
  height?: number;
  barWidth?: number;
  labelColor?: string;
  allLabels?: boolean; // mostra sempre tutte le etichette X (es. sigle paese)
}) {
  const rawMax = Math.max(1, ...bars.map((b) => b.value));
  const top = niceCeil(rawMax);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => f * top); // dall'alto in basso
  // Mostra un'etichetta X ogni N per non affollare (ma sempre il giorno evidenziato).
  const everyX = allLabels ? 1 : bars.length > 10 ? 2 : 1;

  return (
    <div className="pt-1">
      <div className="flex gap-2">
        {/* Asse Y */}
        <div className="flex w-8 shrink-0 flex-col justify-between py-[1px] text-right font-mono text-[9px] tabular-nums text-faint" style={{ height }}>
          {ticks.map((t, i) => (<span key={i} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">{compact(t)}</span>))}
        </div>

        {/* Area di plotting */}
        <div className="relative flex-1" style={{ height }}>
          {/* griglia orizzontale */}
          {ticks.map((t, i) => (
            <div key={i} className="absolute inset-x-0" style={{ bottom: `${(t / top) * 100}%`, height: 1, backgroundColor: i === ticks.length - 1 ? "var(--line)" : "color-mix(in srgb, var(--line) 60%, transparent)" }} />
          ))}
          {/* colonne */}
          <div className="absolute inset-0 flex items-end justify-between gap-[6px]">
            {bars.map((b, i) => {
              const on = b.highlight;
              const c = on ? "var(--ok)" : (b.color ?? color);
              return (
                <div key={i} className="group flex h-full min-w-0 flex-1 items-end justify-center" title={`${b.label}: ${format(b.value)}`}>
                  <div
                    className="mx-auto w-full rounded-t-[3px] transition-opacity"
                    style={{
                      maxWidth: barWidth,
                      height: `${(b.value / top) * 100}%`,
                      minHeight: b.value > 0 ? 2 : 0,
                      background: b.fill && !on ? b.fill : `linear-gradient(180deg, ${c}, color-mix(in srgb, ${c} 78%, transparent))`,
                      ...(b.fill && !on ? { border: "1px solid color-mix(in srgb, var(--line) 80%, transparent)" } : {}),
                      transformOrigin: "bottom",
                      animation: "growY 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
                      animationDelay: `${i * 0.04}s`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Asse X */}
      <div className="mt-1.5 flex gap-2">
        <div className="w-8 shrink-0" />
        <div className="flex flex-1 justify-between gap-[6px]">
          {bars.map((b, i) => (
            <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-center leading-none" style={{ color: b.highlight ? "var(--ok)" : labelColor, fontWeight: b.highlight ? 700 : 400 }}>
              {b.flag && <span className="text-[15px] leading-none" title={b.label}>{b.flag}</span>}
              <span className="text-[9px]">{(i % everyX === 0 || b.highlight) ? b.label : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
