export interface LinePoint {
  label: string;
  value: number;
}

// Grafico a linea con area (SVG, responsive via viewBox).
export default function LineChart({
  points,
  color = "var(--focus)",
  format = (n) => String(n),
  everyLabel = 5,
}: {
  points: LinePoint[];
  color?: string;
  format?: (n: number) => string;
  everyLabel?: number;
}) {
  const W = 560;
  const H = 150;
  const pad = 26;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 150 }}>
      {/* baseline */}
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--line)" strokeWidth="1" />
      <path d={area} fill={color} style={{ opacity: 0.12, animation: "fadeArea 1.1s ease both", animationDelay: "0.25s" }} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" style={{ strokeDasharray: 2200, strokeDashoffset: 2200, animation: "drawLine 1.1s ease forwards" }} />
      {points.map((p, i) => (i % everyLabel === 0 ? (
        <text key={i} x={x(i)} y={H - 8} fontSize="9" textAnchor="middle" fill="var(--faint)">{p.label}</text>
      ) : null))}
      {n > 0 && (
        <circle cx={x(n - 1)} cy={y(points[n - 1].value)} r="4" fill={color} style={{ animation: "pulseDot 0.5s ease both", animationDelay: "1.1s" }} />
      )}
      <text x={pad} y={14} fontSize="10" fill="var(--faint)">max {format(max)}</text>
    </svg>
  );
}
