"use client";

import { useEffect, useRef, useState } from "react";

type Item = { key: string; node: React.ReactNode; className?: string };

// Striscia orizzontale: si scorre trascinando con la manina.
// Riordino: doppio clic su un grafico → compaiono ◀ ▶ per spostarlo; Esc / ✓ per finire.
export default function ScrollStrip({ items, onReorder, gap = "gap-4" }: { items: Item[]; onReorder?: (keys: string[]) => void; gap?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [grab, setGrab] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // (Lo scroll orizzontale con la rotella è gestito globalmente da <WheelScroll />.)

  // Pan col mouse (per il touch resta lo scroll nativo).
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest("input,button,a,select,textarea")) return; // non rubare i click
    const el = ref.current; if (!el) return;
    pan.current = { x: e.clientX, left: el.scrollLeft, moved: false };
    setGrab(true);
  };
  // Fattore < 1 = trascinamento più lento/controllato (il mouse muove molto, i grafici scorrono poco).
  const DRAG_SPEED = 0.5;
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current, d = pan.current; if (!el || !d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    el.scrollLeft = d.left - dx * DRAG_SPEED;
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

  // Frecce laterali: scorrono di UN grafico per click (al posto della barra di scorrimento).
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(false);
  const updateArrows = () => {
    const el = ref.current; if (!el) return;
    setCanL(el.scrollLeft > 4);
    setCanR(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };
  useEffect(() => {
    updateArrows();
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(updateArrows); ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);
  const stepPx = () => {
    const el = ref.current; if (!el || el.children.length === 0) return 300;
    const kids = el.children;
    if (kids.length > 1) return (kids[1] as HTMLElement).offsetLeft - (kids[0] as HTMLElement).offsetLeft;
    return (kids[0] as HTMLElement).offsetWidth;
  };
  const nudge = (dir: -1 | 1) => { const el = ref.current; if (!el) return; el.scrollBy({ left: dir * stepPx(), behavior: "smooth" }); };

  const activeIdx = items.findIndex((i) => i.key === active);
  const arrowCls = "absolute top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-lg text-txt shadow-md transition hover:bg-wash disabled:pointer-events-none disabled:opacity-0";

  return (
    <div>
      {/* Toolbar riposizionamento SOPRA la striscia (compare al doppio clic su un grafico) */}
      {onReorder && active && (
        <div className="mb-1.5 flex justify-center">
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-1 shadow-md">
            <button type="button" onClick={() => move(active, -1)} disabled={activeIdx <= 0} aria-label="Sposta a sinistra" className="grid h-6 w-6 place-items-center rounded-full text-sm text-dim hover:text-txt disabled:opacity-30">◀</button>
            <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Sposta il grafico</span>
            <button type="button" onClick={() => move(active, 1)} disabled={activeIdx === items.length - 1} aria-label="Sposta a destra" className="grid h-6 w-6 place-items-center rounded-full text-sm text-dim hover:text-txt disabled:opacity-30">▶</button>
            <button type="button" onClick={() => setActive(null)} aria-label="Fine" className="grid h-6 w-6 place-items-center rounded-full text-[color:var(--ok)] hover:opacity-80">✓</button>
          </div>
        </div>
      )}
      <div className="relative">
        <button type="button" onClick={() => nudge(-1)} disabled={!canL} aria-label="Scorri a sinistra" className={`${arrowCls} left-0 -translate-x-1/3`}>‹</button>
        <button type="button" onClick={() => nudge(1)} disabled={!canR} aria-label="Scorri a destra" className={`${arrowCls} right-0 translate-x-1/3`}>›</button>
        <div
          ref={ref}
          onScroll={updateArrows}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={endPan}
          onPointerLeave={endPan}
          className={`ss-strip flex ${gap} overflow-x-auto scroll-smooth pb-1 ${grab ? "cursor-grabbing select-none" : "cursor-grab"}`}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
        >
          {items.map((it) => {
            const on = active === it.key;
            return (
              <div
                key={it.key}
                title={onReorder ? "Doppio clic per riposizionare" : undefined}
                onDoubleClick={(e) => { if (!onReorder) return; e.stopPropagation(); setActive(on ? null : it.key); }}
                className={`relative ${it.className ?? ""}`}
              >
                {onReorder && on && <div className="pointer-events-none absolute inset-0 z-10 rounded-2xl ring-2 ring-[color:var(--focus)]" />}
                {it.node}
              </div>
            );
          })}
        </div>
        <style>{`.ss-strip::-webkit-scrollbar{display:none}`}</style>
      </div>
    </div>
  );
}
