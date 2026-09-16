"use client";

// Core astratto dell'Assistente: una sfera di filamenti luminosi che ruota e "respira" (pulsa),
// stile assistente AI. Reagisce allo stato: idle (calmo) · listen (veloce/brillante) · speak (onda).
// Disegnato su canvas, nei colori del brand (--focus) con bagliore dorato. Nessuna libreria.
import { useEffect, useRef } from "react";

type CoreState = "idle" | "listen" | "speak";

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const R = isNaN(r) ? 190 : r, G = isNaN(g) ? 93 : g, B = isNaN(b) ? 56 : b;
  return `rgba(${R},${G},${B},${Math.max(0, Math.min(1, a))})`;
}

export default function AssistantCore({ state = "idle", size = 148 }: { state?: CoreState; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CoreState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const W = size, H = size;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);

    // Colori: accento del brand (--focus) + un oro caldo per il cuore.
    let focus = "#BE5D38"; const gold = "#F2B24C";
    try { const c = getComputedStyle(document.documentElement).getPropertyValue("--focus").trim(); if (/^#([0-9a-f]{6})$/i.test(c)) focus = c; } catch {}

    // Punti distribuiti su una sfera (spirale di Fibonacci).
    const N = 200, baseR = size * 0.34;
    const pts: { x: number; y: number; z: number }[] = [];
    const off = 2 / N, inc = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) { const y = i * off - 1 + off / 2; const r = Math.sqrt(Math.max(0, 1 - y * y)); const phi = i * inc; pts.push({ x: Math.cos(phi) * r, y, z: Math.sin(phi) * r }); }
    // Filamenti: collega i punti vicini (mesh).
    const edges: [number, number][] = [];
    const thr = 0.4;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z; if (dx * dx + dy * dy + dz * dz < thr * thr) edges.push([i, j]); }

    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const speeds: Record<CoreState, number> = { idle: 0.0024, listen: 0.0062, speak: 0.0042 };
    const cx = W / 2, cy = H / 2;
    let raf = 0, ang = 0, t = 0;

    const draw = () => {
      const s = stateRef.current;
      ang += speeds[s]; t += 0.03;
      const amp = s === "listen" ? 0.10 : s === "speak" ? 0.07 : 0.04;
      const freq = s === "listen" ? 3.0 : s === "speak" ? 2.2 : 1.2;
      const breathe = 1 + amp * Math.sin(t * freq);
      const scale = baseR * breathe;
      const bright = s === "idle" ? 0.6 : 0.9;
      const ca = Math.cos(ang), sa = Math.sin(ang);

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      const proj = pts.map((p) => { const x = p.x * ca - p.z * sa; const z = p.x * sa + p.z * ca; return { X: cx + x * scale, Y: cy + p.y * scale, z }; });

      // Filamenti
      ctx.lineWidth = 0.6;
      for (const [i, j] of edges) { const a = proj[i], b = proj[j]; const depth = (a.z + b.z) / 2; const al = (0.08 + 0.16 * (depth + 1) / 2) * bright; ctx.strokeStyle = rgba(focus, al); ctx.beginPath(); ctx.moveTo(a.X, a.Y); ctx.lineTo(b.X, b.Y); ctx.stroke(); }
      // Nodi
      for (const p of proj) { const d = (p.z + 1) / 2; const rad = 0.6 + 1.9 * d; const al = (0.22 + 0.62 * d) * bright; ctx.fillStyle = rgba(d > 0.62 ? gold : focus, al); ctx.beginPath(); ctx.arc(p.X, p.Y, rad, 0, Math.PI * 2); ctx.fill(); }
      // Bagliore centrale pulsante
      const ga = (0.5 + 0.4 * Math.sin(t * (s === "idle" ? 1.2 : 2.6))) * bright;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR);
      g.addColorStop(0, rgba(gold, 0.55 * ga)); g.addColorStop(0.4, rgba(focus, 0.22 * ga)); g.addColorStop(1, rgba(focus, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, baseR, 0, Math.PI * 2); ctx.fill();

      ctx.globalCompositeOperation = "source-over";
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} className="pointer-events-none select-none" aria-hidden />;
}
