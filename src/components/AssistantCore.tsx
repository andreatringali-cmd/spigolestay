"use client";

// Core dell'Assistente in stile HUD "J.A.R.V.I.S.": anelli/archi concentrici che ruotano e
// pulsano, tacche a quadrante, punti marker e un segmento caldo, con il wordmark XENORA. al centro.
// Theme-aware: cyan "arc-reactor" in tema scuro, tonalità di grigio nella versione chiara.
import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

type CoreState = "idle" | "listen" | "speak";

function rgba(hex: string, a: number) {
  const h = (hex || "#38bdf8").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${isNaN(r) ? 56 : r},${isNaN(g) ? 189 : g},${isNaN(b) ? 248 : b},${Math.max(0, Math.min(1, a))})`;
}

export default function AssistantCore({ state = "idle", size = 200 }: { state?: CoreState; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CoreState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const { theme } = useTheme();
  const light = theme !== "dark";

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const W = size, H = size;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2, cy = H / 2;

    // Palette: grigi in chiaro (no azzurrino), cyan "arc-reactor" in scuro. Accento caldo per i marker.
    const primary = light ? "#8a8f98" : "#38bdf8";
    const secondary = light ? "#b4b8bf" : "#7dd3fc";
    const accent = light ? "#c39a4e" : "#fbbf24";

    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const spd: Record<CoreState, number> = { idle: 0.006, listen: 0.014, speak: 0.010 };
    let raf = 0, t = 0, ang = 0;

    const arc = (r: number, a0: number, a1: number, w: number, col: string, alpha: number, glow = 0) => {
      if (glow && !light) { ctx.shadowColor = rgba(col, 0.85); ctx.shadowBlur = glow; }
      ctx.strokeStyle = rgba(col, alpha); ctx.lineWidth = w; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
      ctx.shadowBlur = 0;
    };

    const draw = () => {
      const s = stateRef.current;
      t += 0.03; ang += spd[s];
      const pulse = 0.5 + 0.5 * Math.sin(t * (s === "listen" ? 3.4 : s === "speak" ? 2.6 : 1.4));
      const breathe = 1 + (s === "listen" ? 0.03 : 0.02) * Math.sin(t * 1.6);
      const R = size * 0.44 * breathe;
      ctx.clearRect(0, 0, W, H);

      // Alone centrale pulsante
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      halo.addColorStop(0, rgba(primary, (light ? 0.10 : 0.22) * (0.6 + 0.4 * pulse)));
      halo.addColorStop(1, rgba(primary, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      // Anello esterno + tacche a quadrante
      arc(R * 0.95, 0, Math.PI * 2, 1, primary, light ? 0.28 : 0.35);
      const ticks = 60;
      for (let i = 0; i < ticks; i++) {
        const th = (i / ticks) * Math.PI * 2, big = i % 5 === 0;
        const r0 = R * (big ? 0.85 : 0.88), r1 = R * 0.94;
        ctx.strokeStyle = rgba(big ? secondary : primary, big ? (light ? 0.5 : 0.6) : (light ? 0.16 : 0.22));
        ctx.lineWidth = big ? 1.4 : 1;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(th) * r0, cy + Math.sin(th) * r0); ctx.lineTo(cx + Math.cos(th) * r1, cy + Math.sin(th) * r1); ctx.stroke();
      }

      // Arco rotante principale (con gap) + arco secondario opposto
      arc(R * 0.78, ang, ang + Math.PI * 1.15, 3, primary, 0.9, 12);
      arc(R * 0.66, -ang * 1.3, -ang * 1.3 + Math.PI * 0.7, 2, secondary, light ? 0.6 : 0.8);

      // Segmento accento caldo (come l'arco evidenziato del riferimento)
      arc(R * 0.86, ang * 0.5, ang * 0.5 + Math.PI * 0.28, 3.5, accent, 0.95, 10);

      // Punti marker (i pallini) che scorrono lungo un anello
      const dots = 5;
      for (let i = 0; i < dots; i++) {
        const th = -Math.PI / 2 + ang * 0.5 + (i / dots) * 0.95, rr = R * 0.86;
        const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr, gl = 0.6 + 0.4 * Math.sin(t * 3 + i);
        if (!light) { ctx.shadowColor = rgba(accent, 0.9); ctx.shadowBlur = 8; }
        ctx.fillStyle = rgba(accent, 0.9); ctx.beginPath(); ctx.arc(x, y, 2 + 1.2 * gl, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Anello interno pulsante attorno al wordmark
      arc(R * 0.52, 0, Math.PI * 2, 1, primary, (light ? 0.24 : 0.35) + 0.2 * pulse);

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, light]);

  return (
    <div className="pointer-events-none relative select-none" style={{ width: size, height: size }} aria-hidden>
      <canvas ref={ref} className="absolute inset-0" />
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-mono font-bold" style={{ fontSize: Math.round(size * 0.112), letterSpacing: "0.14em", color: light ? "#3b3e43" : "#e2f4ff", textShadow: light ? "none" : "0 0 16px rgba(56,189,248,.55)" }}>
          XENORA<span style={{ color: light ? "#c39a4e" : "#fbbf24" }}>.</span>
        </span>
      </div>
    </div>
  );
}
