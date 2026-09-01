// Tachimetro premium: arco con gradiente, tacche, lancetta affusolata, lettura centrale.
export default function Gauge({
  value,
  max = 100,
  label,
  unit = "%",
  color = "var(--focus)",
  format,
}: {
  value: number;
  max?: number;
  label?: string;
  unit?: string;
  color?: string;
  format?: (n: number) => string;
}) {
  const f = Math.max(0, Math.min(1, value / (max || 1)));
  const W = 240, H = 172, cx = W / 2, cy = 130, R = 88, stroke = 15;
  const uid = `g${Math.round(f * 1000)}${max}`; // id gradiente unico per istanza

  const rad = (a: number) => (a * Math.PI) / 180;
  const pt = (a: number, r = R) => [cx + r * Math.cos(rad(a)), cy - r * Math.sin(rad(a))];
  const angle = 180 * (1 - f); // 180° = 0, 0° = max

  const [lx, ly] = pt(180);
  const [rx, ry] = pt(0);
  const [vx, vy] = pt(angle);
  const track = `M ${lx.toFixed(1)} ${ly.toFixed(1)} A ${R} ${R} 0 0 1 ${rx.toFixed(1)} ${ry.toFixed(1)}`;
  const arc = `M ${lx.toFixed(1)} ${ly.toFixed(1)} A ${R} ${R} 0 0 1 ${vx.toFixed(1)} ${vy.toFixed(1)}`;

  // tacche (ogni 10%, maggiori ogni 25%)
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = 180 - i * 18;
    const major = i % 2.5 === 0 || i === 5 || i === 10 || i === 0;
    const [x1, y1] = pt(a, R + stroke / 2 + 2);
    const [x2, y2] = pt(a, R + stroke / 2 + (major ? 8 : 5));
    return { x1, y1, x2, y2, major };
  });

  // lancetta affusolata (sottile e tenue, non si confonde col numero centrale)
  const [nx, ny] = pt(angle, R - 20);
  const [bx1, by1] = pt(angle + 90, 3.2);
  const [bx2, by2] = pt(angle - 90, 3.2);
  const needle = `M ${bx1.toFixed(1)} ${by1.toFixed(1)} L ${nx.toFixed(1)} ${ny.toFixed(1)} L ${bx2.toFixed(1)} ${by2.toFixed(1)} Z`;

  const shown = format ? format(value) : `${Math.round(value)}`;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[250px]">
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={1} />
          </linearGradient>
          <filter id={`${uid}s`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={color} floodOpacity="0.35" />
          </filter>
        </defs>
        {/* tacche */}
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="var(--faint)" strokeOpacity={t.major ? 0.8 : 0.4} strokeWidth={t.major ? 2 : 1} strokeLinecap="round" />
        ))}
        {/* traccia */}
        <path d={track} fill="none" stroke="var(--wash)" strokeWidth={stroke} strokeLinecap="round" />
        {/* valore */}
        <path d={arc} fill="none" stroke={`url(#${uid})`} strokeWidth={stroke} strokeLinecap="round" filter={`url(#${uid}s)`} />
        {/* lancetta + perno (tenue) */}
        <path d={needle} fill="var(--dim)" fillOpacity={0.7} />
        <circle cx={cx} cy={cy} r={6} fill="var(--dim)" />
        <circle cx={cx} cy={cy} r={2.5} fill="var(--surface)" />
        {/* estremi */}
        <text x={lx - 3} y={cy + 24} textAnchor="middle" fontSize={9} fill="var(--faint)">0</text>
        <text x={rx + 3} y={cy + 24} textAnchor="middle" fontSize={9} fill="var(--faint)">{max}{unit}</text>
        {/* lettura centrale */}
        <text x={cx} y={cy - 26} textAnchor="middle" fill="var(--txt)" style={{ fontVariantNumeric: "tabular-nums" }}>
          <tspan fontSize={34} fontWeight={800}>{shown}</tspan>
          <tspan fontSize={15} fontWeight={700} dx={1} fill="var(--dim)">{unit}</tspan>
        </text>
      </svg>
      {label && <div className="-mt-1 text-xs font-medium text-dim">{label}</div>}
    </div>
  );
}
