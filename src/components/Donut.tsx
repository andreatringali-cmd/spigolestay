"use client";

import { useEffect, useState } from "react";

export interface DonutSlice {
  label: string;
  value: number;
  color: string; // può essere una var CSS, es. "var(--ch-booking)"
}

export default function Donut({
  data,
  center,
  format = (n) => String(n),
  showPercent = true,
}: {
  data: DonutSlice[];
  center?: string;
  format?: (n: number) => string;
  showPercent?: boolean;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const size = 150;
  const thickness = 24;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;

  // Al montaggio i segmenti "si disegnano": dash da 0 alla lunghezza reale.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 40);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="anim-pop shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "var(--wash)" }} strokeWidth={thickness} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {total > 0 &&
            data.map((d, i) => {
              const len = (d.value / total) * c;
              const seg = (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  strokeWidth={thickness}
                  strokeLinecap="butt"
                  strokeDasharray={drawn ? `${len} ${c - len}` : `0 ${c}`}
                  strokeDashoffset={-acc}
                  style={{
                    stroke: d.color,
                    transition: "stroke-dasharray 0.75s cubic-bezier(0.22, 1, 0.36, 1)",
                    transitionDelay: `${i * 0.1}s`,
                  }}
                />
              );
              acc += len;
              return seg;
            })}
        </g>
        <text x="50%" y="49%" textAnchor="middle" dominantBaseline="middle" style={{ fill: "var(--txt)", fontSize: 22, fontWeight: 700 }}>
          {center ?? String(total)}
        </text>
        <text x="50%" y="63%" textAnchor="middle" style={{ fill: "var(--faint)", fontSize: 10 }}>
          totale
        </text>
      </svg>

      <div className="flex min-w-[130px] flex-1 flex-col gap-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
            <span className="truncate text-dim">{d.label}</span>
            <span className="ml-auto shrink-0 font-mono font-semibold text-txt">
              {format(d.value)}
              {showPercent && total > 0 && <span className="ml-1 text-faint">· {Math.round((d.value / total) * 100)}%</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
