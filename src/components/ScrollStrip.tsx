"use client";

import { useEffect, useRef, useState } from "react";

type Item = { key: string; node: React.ReactNode; className?: string };

// Striscia orizzontale: si scorre trascinando con la manina.
// Riordino: doppio clic su un grafico → compaiono ◀ ▶ per spostarlo; Esc / ✓ per finire.
export default function ScrollStrip({ items, onReorder }: { items: Item[]; onReorder?: (keys: string[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [grab, setGrab] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Rotellina del mouse sopra i grafici → scorre orizzontalmente (destra/sinistra).
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;              // niente overflow → lascia scorrere la pagina
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;      // già orizzontale (trackpad) → nativo
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pan col mouse (per il touch resta lo scroll nativo).
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest("input,button,a,select,textarea")) return; // non rubare i click
    const el = ref.current; if (!el) return;
    pan.current = { x: e.clientX, left: el.scrollLeft, moved: false };
    setGrab(true);
  };
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current, d = pan.current; if (!el || !d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    el.scrollLeft = d.left - dx;
  };
  const endPan = () => { pan.current = null; setGrab(false); };

  const move = (key: string, dir: -1 | 1) => {
    if (!onReorder) return;
    const keys = items.map((i) => i.key);
    const i = keys.indexOf(key), j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    onReorder(keys); // la card resta attiva (stessa key) per spostamenti successivi
  };

  return (
    <div
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={endPan}
      onPointerLeave={endPan}
      className={`flex gap-4 overflow-x-auto pb-1 ${grab ? "cursor-grabbing select-none" : "cursor-grab"}`}
      style={{ scrollbarWidth: "thin" }}
    >
      {items.map((it, idx) => {
        const on = active === it.key;
        return (
          <div
            key={it.key}
            title={onReorder ? "Doppio clic per riposizionare" : undefined}
            onDoubleClick={(e) => { if (!onReorder) return; e.stopPropagation(); setActive(on ? null : it.key); }}
            className={`relative ${it.className ?? ""}`}
          >
            {onReorder && on && (
              <>
                <div className="pointer-events-none absolute inset-0 z-10 rounded-2xl ring-2 ring-[color:var(--focus)]" />
                <div className="absolute left-1/2 top-1.5 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-surface px-1 py-0.5 shadow-md">
                  <button type="button" onClick={() => move(it.key, -1)} disabled={idx === 0} aria-label="Sposta a sinistra" className="grid h-6 w-6 place-items-center rounded-full text-sm text-dim hover:text-txt disabled:opacity-30">◀</button>
                  <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Sposta</span>
                  <button type="button" onClick={() => move(it.key, 1)} disabled={idx === items.length - 1} aria-label="Sposta a destra" className="grid h-6 w-6 place-items-center rounded-full text-sm text-dim hover:text-txt disabled:opacity-30">▶</button>
                  <button type="button" onClick={() => setActive(null)} aria-label="Fine" className="grid h-6 w-6 place-items-center rounded-full text-[color:var(--ok)] hover:opacity-80">✓</button>
                </div>
              </>
            )}
            {it.node}
          </div>
        );
      })}
    </div>
  );
}
