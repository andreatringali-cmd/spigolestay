"use client";

// Core astratto dell'Assistente: sfera di nodi + anelli orbitali che ruotano e "respirano" (pulsano).
// Pensato per SFONDO CHIARO (compositing normale, colori del brand saturi). Reagisce allo stato.
import { useEffect, useRef } from "react";

type CoreState = "idle" | "listen" | "speak";
type P3 = { x: number; y: number; z: number };

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const R = isNaN(r) ? 190 : r, G = isNaN(g) ? 93 : g, B = isNaN(b) ? 56 : b;
  return `rgba(${R},${G},${B},${Math.max(0, Math.min(1, a))})`;
}
const rotX = (p: P3, a: number): P3 => ({ x: p.x, y: p.y * Math.cos(a) - p.z * Math.sin(a), z: p.y * Math.sin(a) + p.z * Math.cos(a) });
const rotZ = (p: P3, a: number): P3 => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a), z: p.z });

export default function AssistantCore({ state = "idle", size = 176 }: { state?: CoreState; size?: number }) {
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

    // Palette calda del brand, satura per risaltare su bianco.
    let focus = "#BE5D38"; const gold = "#E7962E", amber = "#C9662F";
    try { const c = getComputedStyle(document.documentElement).getPropertyValue("--focus").trim(); if (/^#([0-9a-f]{6})$/i.test(c)) focus = c; } catch {}

    const baseR = size * 0.33;

    // Nodi (sfondo) — spirale di Fibonacci.
    const N = 96;
    const pts: P3[] = [];
    const off = 2 / N, inc = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) { const y = i * off - 1 + off / 2; const r = Math.sqrt(Math.max(0, 1 - y * y)); const phi = i * inc; pts.push({ x: Math.cos(phi) * r, y, z: Math.sin(phi) * r }); }

    // Anelli orbitali (cerchi massimi inclinati) — i "filamenti".
    const M = 110;
    const ringDefs = [
      { tiltX: 0.32, tiltZ: 0.0, speed: 1.0, col: focus },
      { tiltX: -0.62, tiltZ: 0.95, speed: 1.4, col: amber },
      { tiltX: 1.15, tiltZ: -0.5, speed: 0.78, col: gold },
    ];
    const rings = ringDefs.map((rd) => {
      const arr: P3[] = [];
      for (let i = 0; i <= M; i++) { const th = (i / M) * Math.PI * 2; let p: P3 = { x: Math.cos(th), y: 0, z: Math.sin(th) }; p = rotX(p, rd.tiltX); p = rotZ(p, rd.tiltZ); arr.push(p); }
      return { pts: arr, speed: rd.speed, col: rd.col };
    });

    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const speeds: Record<CoreState, number> = { idle: 0.0026, listen: 0.0066, speak: 0.0046 };
    const cx = W / 2, cy = H / 2;
    let raf = 0, ang = 0, t = 0;

    const project = (p: P3, ca: number, sa: number, scale: number) => { const x = p.x * ca - p.z * sa; const z = p.x * sa + p.z * ca; return { X: cx + x * scale, Y: cy + p.y * scale, z }; };

    const draw = () => {
      const s = stateRef.current;
      ang += speeds[s]; t += 0.03;
      const amp = s === "listen" ? 0.09 : s === "speak" ? 0.06 : 0.04;
      const freq = s === "listen" ? 3.0 : s === "speak" ? 2.2 : 1.2;
      const breathe = 1 + amp * Math.sin(t * freq);
      const scale = baseR * breathe;
      const ca = Math.cos(ang), sa = Math.sin(ang);

      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round"; ctx.lineJoin = "round";

      // Alone morbido
      const halo = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * 1.5);
      halo.addColorStop(0, rgba(focus, 0.16)); halo.addColorStop(1, rgba(focus, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, baseR * 1.5, 0, Math.PI * 2); ctx.fill();

      // Nodi sfera
      for (const p of pts) { const pr = project(p, ca, sa, scale); const d = (pr.z + 1) / 2; const rad = 0.5 + 1.3 * d; const al = 0.12 + 0.32 * d; ctx.fillStyle = rgba(focus, al); ctx.beginPath(); ctx.arc(pr.X, pr.Y, rad, 0, Math.PI * 2); ctx.fill(); }

      // Anelli orbitali: sotto-tratto morbido + tratto nitido per profondità
      for (const rg of rings) {
        const a2 = ang * rg.speed, c2 = Math.cos(a2), s2 = Math.sin(a2);
        const proj = rg.pts.map((p) => project(p, c2, s2, scale));
        ctx.strokeStyle = rgba(rg.col, 0.12); ctx.lineWidth = 5;
        ctx.beginPath(); proj.forEach((q, i) => (i ? ctx.lineTo(q.X, q.Y) : ctx.moveTo(q.X, q.Y))); ctx.stroke();
        for (let i = 1; i < proj.length; i++) { const a = proj[i - 1], b = proj[i]; const d = ((a.z + b.z) / 2 + 1) / 2; const al = 0.22 + 0.7 * d; ctx.strokeStyle = rgba(rg.col, al); ctx.lineWidth = 0.7 + 1.6 * d; ctx.beginPath(); ctx.moveTo(a.X, a.Y); ctx.lineTo(b.X, b.Y); ctx.stroke(); }
      }

      // Nucleo pulsante
      const ga = 0.7 + 0.3 * Math.sin(t * (s === "idle" ? 1.3 : 2.8));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 0.75);
      g.addColorStop(0, rgba(gold, 0.95 * ga)); g.addColorStop(0.5, rgba(amber, 0.5 * ga)); g.addColorStop(1, rgba(focus, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, baseR * 0.75, 0, Math.PI * 2); ctx.fill();

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} className="pointer-events-none select-none" aria-hidden />;
}
