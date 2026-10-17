"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Riquadro di firma (canvas) — l'ospite firma col dito/mouse; esporta una dataURL PNG.
// Il tratto è memorizzato in coordinate relative (0–1): se il riquadro cambia dimensione (rotazione del telefono, tastiera, resize)
// il disegno viene ridisegnato in scala senza perdere la firma già tracciata.
type Pt = { x: number; y: number };

export default function SignaturePad({ value, onChange, height = 150, placeholder = "Firma qui col dito o col mouse", clearLabel = "Cancella firma" }: { value?: string; onChange: (dataUrl: string | undefined) => void; height?: number; placeholder?: string; clearLabel?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef<Pt[][]>([]); // tratti già fatti (coordinate relative alla larghezza e all'altezza del riquadro)
  const current = useRef<Pt[] | null>(null);
  const base = useRef<HTMLImageElement | null>(null); // firma già presente (valore iniziale), ridisegnata sotto i nuovi tratti
  const [empty, setEmpty] = useState(!value);

  const redraw = useCallback(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    if (w <= 0) return;
    // Cambiare width/height svuota il canvas: lo ridisegno da zero (immagine di base + tutti i tratti).
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(height * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(height * dpr); }
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1f2430";
    if (base.current && base.current.complete && base.current.naturalWidth) ctx.drawImage(base.current, 0, 0, w, height);
    const all = current.current ? [...strokes.current, current.current] : strokes.current;
    for (const s of all) {
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x * w, s[0].y * height);
      if (s.length === 1) ctx.lineTo(s[0].x * w + 0.01, s[0].y * height);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x * w, s[i].y * height);
      ctx.stroke();
    }
  }, [height]);

  // Prima disegno + immagine iniziale; poi segue ogni cambio di dimensione del riquadro.
  useEffect(() => {
    const c = ref.current; if (!c) return;
    if (value && !base.current && !strokes.current.length) {
      const img = new Image();
      img.onload = () => { base.current = img; redraw(); };
      img.src = value;
    }
    redraw();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => redraw()) : null;
    ro?.observe(c);
    const onWin = () => redraw();
    window.addEventListener("resize", onWin);
    window.addEventListener("orientationchange", onWin);
    return () => { ro?.disconnect(); window.removeEventListener("resize", onWin); window.removeEventListener("orientationchange", onWin); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, redraw]);

  const pos = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / (r.height || 1)));
    return { x, y };
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    drawing.current = true;
    current.current = [pos(e)];
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* alcuni browser non lo supportano */ }
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !current.current) return;
    current.current.push(pos(e));
    redraw();
    if (empty) setEmpty(false);
  };
  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const c = ref.current!;
    // Un tocco senza movimento (un solo punto) non disegna nulla: lo scarto, così il tap accidentale non vale come firma.
    if (current.current && current.current.length >= 2) strokes.current.push(current.current);
    current.current = null;
    const hasInk = strokes.current.length > 0 || !!base.current;
    if (hasInk) setEmpty(false);
    onChange(hasInk ? c.toDataURL("image/png") : undefined);
  };
  // Se il puntatore è "catturato" il tratto prosegue anche fuori dal riquadro: lo chiudo solo al rilascio vero.
  const leave = (e: React.PointerEvent) => {
    let captured = false;
    try { captured = !!ref.current?.hasPointerCapture(e.pointerId); } catch { /* niente */ }
    if (!captured) finish();
  };
  const clear = () => {
    strokes.current = []; current.current = null; base.current = null; drawing.current = false;
    redraw();
    setEmpty(true);
    onChange(undefined);
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-line bg-paper">
        <canvas ref={ref} style={{ width: "100%", height, touchAction: "none", cursor: "crosshair" }} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onPointerLeave={leave} />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-faint">{placeholder}</span>}
      </div>
      <div className="mt-1 flex justify-end"><button type="button" onClick={clear} className="text-[11px] font-medium text-dim hover:text-[color:var(--err)]">{clearLabel}</button></div>
    </div>
  );
}
