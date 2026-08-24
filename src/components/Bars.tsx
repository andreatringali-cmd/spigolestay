/* eslint-disable @typescript-eslint/no-explicit-any */
// Barre orizzontali (label · barra · valore).
export default function Bars({ items }: { items: any[] }) {
  const max = Math.max(1, ...items.map((i) => i.max ?? i.value));
  return (
    <div className="flex flex-col gap-3 pt-1">
      {items.map((it, i) => (
        <div key={i}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-dim">{it.label}</span>
            <span className="font-mono font-semibold text-txt">{it.fmt ? it.fmt(it.value) : it.value}{it.suffix ?? ""}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-wash">
            <div
              className="anim-grow h-full rounded-full"
              style={{
                width: `${(it.value / (it.max ?? max)) * 100}%`,
                backgroundColor: it.color ?? "var(--focus)",
                transition: "width 0.7s cubic-bezier(0.22, 1, 0.36, 1)",
                animationDelay: `${i * 0.08}s`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
