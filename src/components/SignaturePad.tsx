"use client";

import { useEffect, useRef, useState } from "react";

// Riquadro di firma (canvas) — l'ospite firma col dito/mouse; esporta una dataURL PNG.
export default function SignaturePad({ value, onChange, height = 150 }: { value?: string; onChange: (dataUrl: string | undefined) => void; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(!value);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    c.width = w * dpr; c.height = height * dpr;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "#1f2430";
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, w, height); img.src = value; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { e.preventDefault(); drawing.current = true; last.current = pos(e); ref.current?.setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext("2d")!; const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p; if (empty) setEmpty(false);
  };
  const up = () => { if (!drawing.current) return; drawing.current = false; const c = ref.current!; onChange(empty ? undefined : c.toDataURL("image/png")); };
  const clear = () => { const c = ref.current!; const ctx = c.getContext("2d")!; ctx.clearRect(0, 0, c.width, c.height); setEmpty(true); onChange(undefined); };

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-line bg-paper">
        <canvas ref={ref} style={{ width: "100%", height, touchAction: "none", cursor: "crosshair" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-faint">Firma qui col dito o col mouse</span>}
      </div>
      <div className="mt-1 flex justify-end"><button type="button" onClick={clear} className="text-[11px] font-medium text-dim hover:text-[color:var(--err)]">Cancella firma</button></div>
    </div>
  );
}
