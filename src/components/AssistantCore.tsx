"use client";

// Core astratto dell'Assistente, stile AI (tipo J.A.R.V.I.S.): una sfera di nodi + anelli orbitali
// dorati che ruotano e "respirano" (pulsano). Reagisce allo stato: idle · listen · speak.
// Disegnato su canvas con blending additivo (pensato per sfondo scuro). Nessuna libreria.
import { useEffect, useRef } from "react";

type CoreState = "idle" | "listen" | "speak";
type P3 = { x: number; y: number; z: number };

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const R = isNaN(r) ? 242 : r, G = isNaN(g) ? 178 : g, B = isNaN(b) ? 76 : b;
  return `rgba(${R},${G},${B},${Math.max(0, Math.min(1, a))})`;
}

// Rotazioni base
const rotX = (p: P3, a: number): P3 => ({ x: p.x, y: p.y * Math.cos(a) - p.z * Math.sin(a), z: p.y * Math.sin(a) + p.z * Math.cos(a) });
const rotZ = (p: P3, a: number): P3 => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a), z: p.z });

export default function AssistantCore({ state = "idle", size = 184 }: { state?: CoreState; size?: number }) {
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

    const gold = "#F4B740", amber = "#E88A3C";
    let focus = "#E8A24C";
    try { const c = getComputedStyle(document.documentElement).getPropertyValue("--focus").trim(); if (/^#([0-9a-f]{6})$/i.test(c)) focus = c; } catch {}

    const baseR = size * 0.34;

    // Nodi su sfera (spirale di Fibonacci) — texture di sfondo.
    const N = 150;
    const pts: P3[] = [];
    const off = 2 / N, inc = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) { const y = i * off - 1 + off / 2; const r = Math.sqrt(Math.max(0, 1 - y * y)); const phi = i * inc; pts.push({ x: Math.cos(phi) * r, y, z: Math.sin(phi) * r }); }

    // Anelli orbitali (cerchi massimi con diverse inclinazioni) — i "filamenti" luminosi.
    const M = 96;
    const ringDefs = [
      { tiltX: 0.35, tiltZ: 0.0, speed: 1.0 },
      { tiltX: -0.6, tiltZ: 0.9, speed: 1.35 },
      { tiltX: 1.1, tiltZ: -0.5, speed: 0.8 },
    ];
    const rings = ringDefs.map((rd) => {
      const arr: P3[] = [];
      for (let i = 0; i <= M; i++) { const th = (i / M) * Math.PI * 2; let p: P3 = { x: Math.cos(th), y: 0, z: Math.sin(th) }; p = rotX(p, rd.tiltX); p = rotZ(p, rd.tiltZ); arr.push(p); }
      return { pts: arr, speed: rd.speed };
    });

    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const speeds: Record<CoreState, number> = { idle: 0.0026, listen: 0.0066, speak: 0.0046 };
    const cx = W / 2, cy = H / 2;
    let raf = 0, ang = 0, t = 0;

    const project = (p: P3, ca: number, sa: number, scale: number) => { const x = p.x * ca - p.z * sa; const z = p.x * sa + p.z * ca; return { X: cx + x * scale, Y: cy + p.y * scale, z }; };

    const draw = () => {
      const s = stateRef.current;
      ang += speeds[s]; t += 0.03;
      const amp = s === "listen" ? 0.10 : s === "speak" ? 0.07 : 0.045;
      const freq = s === "listen" ? 3.0 : s === "speak" ? 2.2 : 1.2;
      const breathe = 1 + amp * Math.sin(t * freq);
      const scale = baseR * breathe;
      const bright = s === "idle" ? 0.75 : 1;
      const ca = Math.cos(ang), sa = Math.sin(ang);

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      // Nodi (sfondo)
      for (const p of pts) { const pr = project(p, ca, sa, scale); const d = (pr.z + 1) / 2; const rad = 0.5 + 1.4 * d; const al = (0.12 + 0.4 * d) * bright; ctx.fillStyle = rgba(d > 0.6 ? gold : focus, al); ctx.beginPath(); ctx.arc(pr.X, pr.Y, rad, 0, Math.PI * 2); ctx.fill(); }

      // Anelli orbitali luminosi (filamenti)
      for (let k = 0; k < rings.length; k++) {
        const rg = rings[k];
        const a2 = ang * rg.speed;
        const c2 = Math.cos(a2), s2 = Math.sin(a2);
        const proj = rg.pts.map((p) => project(p, c2, s2, scale));
        // alone largo e tenue
        ctx.strokeStyle = rgba(gold, 0.10 * bright); ctx.lineWidth = 4;
        ctx.beginPath(); proj.forEach((q, i) => (i ? ctx.lineTo(q.X, q.Y) : ctx.moveTo(q.X, q.Y))); ctx.stroke();
        // linea nitida, luminosità per profondità (segmento per segmento)
        for (let i = 1; i < proj.length; i++) { const a = proj[i - 1], b = proj[i]; const d = ((a.z + b.z) / 2 + 1) / 2; const al = (0.15 + 0.6 * d) * bright; ctx.strokeStyle = rgba(k === 1 ? amber : gold, al); ctx.lineWidth = 0.8 + 1.4 * d; ctx.beginPath(); ctx.moveTo(a.X, a.Y); ctx.lineTo(b.X, b.Y); ctx.stroke(); }
      }

      // Nucleo: bagliore centrale pulsante intenso
      const ga = (0.6 + 0.4 * Math.sin(t * (s === "idle" ? 1.3 : 2.8))) * bright;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 1.15);
      g.addColorStop(0, rgba(gold, 0.9 * ga)); g.addColorStop(0.25, rgba(amber, 0.5 * ga)); g.addColorStop(0.6, rgba(focus, 0.18 * ga)); g.addColorStop(1, rgba(focus, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, baseR * 1.15, 0, Math.PI * 2); ctx.fill();

      ctx.globalCompositeOperation = "source-over";
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} className="pointer-events-none select-none" aria-hidden />;
}
