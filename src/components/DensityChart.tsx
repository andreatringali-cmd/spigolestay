// Density plot: curve di densità (KDE gaussiano) sovrapposte e semi-trasparenti, una per categoria.
// Altezza del disegno fissa (come gli altri grafici); assi e legenda in HTML sotto.
type DSeries = { label: string; color: string; values: number[] };

export default function DensityChart({
  series,
  domain,
  xLabel,
  unit = "",
  height = 150,
  legend = true,
}: {
  series: DSeries[];
  domain?: [number, number];
  xLabel?: string;
  unit?: string;
  height?: number;
  legend?: boolean;
}) {
  const withData = series.filter((s) => s.values.length > 0);
  if (!withData.length) return <div className="grid h-[150px] place-items-center text-sm text-faint">Nessun dato nel periodo</div>;

  const all = withData.flatMap((s) => s.values);
  const x0 = domain ? domain[0] : Math.min(...all);
  const x1r = domain ? domain[1] : Math.max(...all, x0 + 1);
  const x1 = x1r <= x0 ? x0 + 1 : x1r;

  const W = 560, H = 150, padT = 8, padB = 2;
  const N = 72;
  const grid = Array.from({ length: N }, (_, i) => x0 + ((x1 - x0) * i) / (N - 1));
  const h = Math.max((x1 - x0) / 14, 0.5); // banda del kernel

  const dens = withData.map((s) => {
    const d = grid.map((gx) => {
      let sum = 0;
      for (const v of s.values) { const z = (gx - v) / h; sum += Math.exp(-0.5 * z * z); }
      return sum / (s.values.length * h * Math.sqrt(2 * Math.PI));
    });
    return { ...s, d };
  });
  const maxD = Math.max(1e-9, ...dens.flatMap((s) => s.d));

  const sx = (gx: number) => ((gx - x0) / (x1 - x0)) * W;
  const sy = (dv: number) => H - padB - (dv / maxD) * (H - padT - padB);
  const baseY = H - padB;

  const areaPath = (d: number[]) => {
    let p = `M 0 ${baseY}`;
    d.forEach((dv, i) => { p += ` L ${sx(grid[i]).toFixed(1)} ${sy(dv).toFixed(1)}`; });
    p += ` L ${W} ${baseY} Z`;
    return p;
  };
  const linePath = (d: number[]) => d.map((dv, i) => `${i === 0 ? "M" : "L"} ${sx(grid[i]).toFixed(1)} ${sy(dv).toFixed(1)}`).join(" ");

  const ticks = Array.from({ length: 5 }, (_, i) => Math.round(x0 + ((x1 - x0) * i) / 4));

  return (
    <div className="flex flex-col gap-1">
      {legend && (
        <div className="-mt-1 flex flex-wrap justify-end gap-x-3 gap-y-0.5">
          {withData.map((s) => (
            <span key={s.label} className="flex items-center gap-1 text-[10px] text-dim"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color, opacity: 0.8 }} />{s.label}</span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
        <line x1={0} y1={baseY} x2={W} y2={baseY} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {dens.map((s, i) => (
          <path key={`a${i}`} d={areaPath(s.d)} fill={s.color} fillOpacity={0.28} stroke="none" />
        ))}
        {dens.map((s, i) => (
          <path key={`l${i}`} d={linePath(s.d)} fill="none" stroke={s.color} strokeWidth={1.6} strokeOpacity={0.9} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {/* asse X in HTML (niente distorsione del testo) */}
      <div className="flex justify-between text-[10px] text-faint">
        {ticks.map((tk, i) => <span key={i}>{tk}{unit}</span>)}
      </div>
      {xLabel && <div className="text-center text-[10px] text-faint">{xLabel}</div>}
    </div>
  );
}
