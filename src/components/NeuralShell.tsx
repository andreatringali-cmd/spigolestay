"use client";

// "Neural Shell" dell'Assistente: a SINISTRA i dati delle varie sessioni (ingest),
// che fluiscono lungo linee curve con particelle verso il CORE astratto a DESTRA
// (l'AI che "studia" e restituisce). Sfondo chiaro, stile terminale futuristico.
// Grafica scenografica: i numeri sono reali, l'animazione è decorativa.
import { useEffect, useRef } from "react";
import AssistantCore from "./AssistantCore";

export interface ShellInput { label: string; value: string; tone: string; q?: string }
type CoreState = "idle" | "listen" | "speak";

function rgba(hex: string, a: number) {
  const h = (hex || "#BE5D38").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r || 190},${g || 93},${b || 56},${Math.max(0, Math.min(1, a))})`;
}
function cssVar(name: string, fallback: string) {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch { return fallback; }
}

export default function NeuralShell({ inputs, state = "idle", coreSize = 190, onInput }: {
  inputs: ShellInput[]; state?: CoreState; coreSize?: number; onInput?: (q: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputsRef = useRef(inputs);
  useEffect(() => { inputsRef.current = inputs; }, [inputs]);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0;
    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);

    const focus = cssVar("--focus", "#BE5D38");
    const flowCols = [focus, "#E7962E", "#2F9E6F", "#5B74E6", "#C9662F"];

    // Particelle: fase casuale per ogni connessione.
    const ROWS = () => Math.max(1, inputsRef.current.length);
    const parts = Array.from({ length: 46 }, () => ({ line: 0, t: Math.random(), spd: 0.003 + Math.random() * 0.006, r: 1 + Math.random() * 1.6 }));

    let raf = 0, tk = 0;
    const anchors = () => {
      const n = ROWS();
      const isNarrow = W < 640;
      const leftX = isNarrow ? W * 0.5 : W * 0.30;
      const coreX = isNarrow ? W * 0.5 : W * 0.72;
      const coreY = isNarrow ? H * 0.62 : H * 0.5;
      const topPad = isNarrow ? H * 0.06 : H * 0.12;
      const botPad = isNarrow ? H * 0.5 : H * 0.12;
      const usable = H - topPad - botPad;
      const A = Array.from({ length: n }, (_, i) => ({ x: leftX, y: topPad + (n === 1 ? usable / 2 : (usable * i) / (n - 1)) }));
      return { A, C: { x: coreX, y: coreY }, isNarrow };
    };
    // Punto lungo la curva bezier A→C (control point che dà la "piega").
    const bez = (a: { x: number; y: number }, c: { x: number; y: number }, t: number) => {
      const mx = (a.x + c.x) / 2, cpx = mx, cpy = a.y; // curva orizzontale morbida
      const u = 1 - t;
      return { x: u * u * a.x + 2 * u * t * cpx + t * t * c.x, y: u * u * a.y + 2 * u * t * cpy + t * t * c.y };
    };

    const draw = () => {
      tk += 0.016;
      const { A, C } = anchors();
      ctx.clearRect(0, 0, W, H);

      // Griglia tenue di sfondo
      ctx.strokeStyle = rgba(cssVar("--line", "#e7ded3").startsWith("#") ? cssVar("--line", "#e7ded3") : "#e7ded3", 0.5);
      ctx.lineWidth = 1;
      const step = 34;
      ctx.globalAlpha = 0.35;
      for (let x = (tk * 6) % step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.globalAlpha = 1;

      // Linee di flusso A→C
      A.forEach((a, i) => {
        const col = flowCols[i % flowCols.length];
        ctx.strokeStyle = rgba(col, 0.22); ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let t = 0; t <= 1; t += 0.05) { const p = bez(a, C, t); if (t === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
        ctx.stroke();
        // Nodo sorgente pulsante
        const pulse = 0.5 + 0.5 * Math.sin(tk * 2 + i);
        ctx.fillStyle = rgba(col, 0.5 + 0.4 * pulse);
        ctx.beginPath(); ctx.arc(a.x, a.y, 2.5 + 1.6 * pulse, 0, Math.PI * 2); ctx.fill();
      });

      // Particelle che viaggiano verso il core
      const n = A.length;
      for (const pt of parts) {
        if (!reduce) pt.t += pt.spd;
        if (pt.t >= 1) { pt.t = 0; pt.line = Math.floor(Math.random() * n); }
        const li = pt.line % n; const a = A[li]; if (!a) continue;
        const col = flowCols[li % flowCols.length];
        const p = bez(a, C, pt.t);
        const fade = pt.t < 0.1 ? pt.t / 0.1 : pt.t > 0.85 ? (1 - pt.t) / 0.15 : 1;
        ctx.fillStyle = rgba(col, 0.9 * fade);
        ctx.beginPath(); ctx.arc(p.x, p.y, pt.r, 0, Math.PI * 2); ctx.fill();
      }

      // Alone di "assorbimento" attorno al core (dove i dati arrivano)
      const glow = 0.6 + 0.4 * Math.sin(tk * (state === "listen" ? 4 : state === "speak" ? 3 : 1.6));
      const g = ctx.createRadialGradient(C.x, C.y, 0, C.x, C.y, coreSize * 0.62);
      g.addColorStop(0, rgba(focus, 0.10 * glow)); g.addColorStop(1, rgba(focus, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C.x, C.y, coreSize * 0.62, 0, Math.PI * 2); ctx.fill();

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [state, coreSize]);

  const mono = "font-mono";
  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-2xl border border-line bg-surface" style={{ minHeight: 360 }}>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden />

      {/* Intestazione stile terminale */}
      <div className="relative flex items-center justify-between px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
        <span className={mono}>XENORA · NEURAL SHELL</span>
        <span className={mono} style={{ color: "var(--ok)" }}>● {state === "listen" ? "ASCOLTO" : state === "speak" ? "OUTPUT" : "LIVE"}</span>
      </div>

      {/* Colonna sinistra: gli input dalle sessioni */}
      <div className="pointer-events-none absolute left-0 top-10 bottom-0 z-10 flex w-[46%] flex-col justify-evenly gap-1 px-3 sm:w-[30%]">
        {inputs.map((it) => (
          <button key={it.label} onClick={() => it.q && onInput?.(it.q)}
            className="pointer-events-auto rounded-lg border border-line bg-paper/80 px-2.5 py-1.5 text-left backdrop-blur-sm transition hover:border-focus"
            style={{ boxShadow: "0 1px 6px rgba(40,30,20,.05)" }}>
            <div className={`${mono} text-[9px] font-semibold uppercase tracking-wide text-faint`}>{it.label}</div>
            <div className={`${mono} text-lg font-bold leading-tight`} style={{ color: it.tone }}>{it.value}</div>
          </button>
        ))}
      </div>

      {/* Core a destra */}
      <div className="pointer-events-none absolute right-[2%] top-[46px] bottom-0 z-10 grid w-[40%] place-items-center sm:right-[6%]">
        <AssistantCore state={state} size={coreSize} />
      </div>
    </div>
  );
}
