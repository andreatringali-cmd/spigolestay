"use client";

// Core dell'Assistente in stile HUD "J.A.R.V.I.S.": anelli concentrici sottili, un quadrante di
// tacche ordinato, un arco rotante con gap e cap arrotondati, un segmento caldo d'accento e il
// wordmark XENORA. al centro. Una sola animazione orchestrata e discreta (respiro + rotazione lenta).
// Theme-aware: cyan "arc-reactor" in tema scuro, GRIGI neutri caldi (niente azzurrino) in chiaro.
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

    // Palette: GRIGI neutri caldi in chiaro (armonizzati col greige dell'app), cyan "arc-reactor" in
    // scuro. Un solo accento caldo (oro in chiaro, ambra in scuro) per i marker e il segmento vivo.
    const primary = light ? "#8C857A" : "#38bdf8";
    const secondary = light ? "#B4AEA4" : "#7dd3fc";
    const faint = light ? "#CBC5BB" : "#4A6070";
    const accent = light ? "#B8934E" : "#fbbf24";

    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const spd: Record<CoreState, number> = { idle: 0.0045, listen: 0.011, speak: 0.008 };
    let raf = 0, t = 0, ang = 0;

    const ringArc = (r: number, a0: number, a1: number, w: number, col: string, alpha: number, glow = 0, cap: CanvasLineCap = "round") => {
      if (glow && !light) { ctx.shadowColor = rgba(col, 0.8); ctx.shadowBlur = glow; }
      ctx.strokeStyle = rgba(col, alpha); ctx.lineWidth = w; ctx.lineCap = cap;
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
      ctx.shadowBlur = 0;
    };

    const draw = () => {
      const s = stateRef.current;
      t += 0.03; ang += spd[s];
      const pulse = 0.5 + 0.5 * Math.sin(t * (s === "listen" ? 3.0 : s === "speak" ? 2.4 : 1.25));
      const breathe = 1 + (s === "listen" ? 0.022 : 0.014) * Math.sin(t * 1.5);
      const R = size * 0.45 * breathe;
      ctx.clearRect(0, 0, W, H);

      // Alone centrale morbido (respiro)
      const halo = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
      halo.addColorStop(0, rgba(primary, (light ? 0.09 : 0.20) * (0.55 + 0.45 * pulse)));
      halo.addColorStop(1, rgba(primary, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      // Anello esterno sottile
      ringArc(R * 0.97, 0, Math.PI * 2, 1, primary, light ? 0.24 : 0.30);

      // Quadrante di tacche ordinato: 72 tacche, "medie" ogni 6, "cardinali" ogni 18 (4 assi).
      const ticks = 72;
      for (let i = 0; i < ticks; i++) {
        const th = (i / ticks) * Math.PI * 2 - Math.PI / 2;
        const cardinal = i % 18 === 0, major = i % 6 === 0;
        const len = cardinal ? R * 0.11 : major ? R * 0.07 : R * 0.035;
        const r1 = R * 0.94, r0 = r1 - len;
        const col = cardinal ? secondary : major ? primary : faint;
        ctx.strokeStyle = rgba(col, cardinal ? (light ? 0.55 : 0.7) : major ? (light ? 0.32 : 0.42) : (light ? 0.16 : 0.2));
        ctx.lineWidth = cardinal ? 1.5 : major ? 1.1 : 0.8;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(th) * r0, cy + Math.sin(th) * r0); ctx.lineTo(cx + Math.cos(th) * r1, cy + Math.sin(th) * r1); ctx.stroke();
      }

      // Arco rotante principale con gap e cap arrotondati + arco secondario controrotante
      ringArc(R * 0.80, ang, ang + Math.PI * 1.2, 2.6, primary, light ? 0.75 : 0.9, 12);
      ringArc(R * 0.80, ang + Math.PI * 1.42, ang + Math.PI * 1.72, 2.6, primary, light ? 0.4 : 0.55);
      ringArc(R * 0.68, -ang * 1.25, -ang * 1.25 + Math.PI * 0.62, 1.6, secondary, light ? 0.5 : 0.75);

      // Segmento caldo d'accento (l'arco "vivo" del riferimento)
      ringArc(R * 0.88, ang * 0.55, ang * 0.55 + Math.PI * 0.24, 3, accent, light ? 0.85 : 0.95, 10);

      // Marker che scorrono lungo un anello (pochi, eleganti)
      const dots = 3;
      for (let i = 0; i < dots; i++) {
        const th = -Math.PI / 2 + ang * 0.55 + (i / dots) * 0.7, rr = R * 0.88;
        const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr, gl = 0.55 + 0.45 * Math.sin(t * 2.6 + i);
        if (!light) { ctx.shadowColor = rgba(accent, 0.9); ctx.shadowBlur = 8; }
        ctx.fillStyle = rgba(accent, light ? 0.85 : 0.9); ctx.beginPath(); ctx.arc(x, y, 1.8 + 1 * gl, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Anello interno fine + anello tratteggiato attorno al wordmark
      ringArc(R * 0.545, 0, Math.PI * 2, 1, primary, (light ? 0.22 : 0.32) + 0.16 * pulse);
      ctx.save();
      ctx.setLineDash([2, 7]); ctx.lineDashOffset = -ang * 8;
      ringArc(R * 0.60, 0, Math.PI * 2, 1, faint, light ? 0.4 : 0.4);
      ctx.restore();

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, light]);

  return (
    <div className="pointer-events-none relative select-none" style={{ width: size, height: size }} aria-hidden>
      <canvas ref={ref} className="absolute inset-0" />
      <div className="absolute inset-0 grid place-items-center">
        <span
          className="font-display font-bold"
          style={{
            fontSize: Math.round(size * 0.118),
            letterSpacing: "0.16em",
            paddingLeft: "0.16em",
            color: light ? "#33302A" : "#EAF6FF",
            textShadow: light ? "none" : "0 0 18px rgba(56,189,248,.5)",
          }}
        >
          XENORA<span style={{ color: light ? "#B8934E" : "#fbbf24" }}>.</span>
        </span>
      </div>
    </div>
  );
}
