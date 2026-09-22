"use client";

// "Neural Shell" dell'Assistente: una CONSOLE futuristica. I dati delle sessioni entrano
// da SINISTRA e da DESTRA come card glass e fluiscono lungo linee curve con particelle verso
// il CORE astratto al CENTRO (l'AI che "studia" e restituisce). I numeri sono reali,
// l'animazione è decorativa. Sfondo scuro "neural" per un effetto scenografico.
import { useEffect, useRef, useMemo } from "react";
import AssistantCore from "./AssistantCore";

export interface ShellInput { label: string; value: string; tone: string; q?: string }
type CoreState = "idle" | "listen" | "speak";

function rgba(hex: string, a: number) {
  const h = (hex || "#5B74E6").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r || 91},${g || 116},${b || 230},${Math.max(0, Math.min(1, a))})`;
}
function cssVar(name: string, fallback: string) {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch { return fallback; }
}

export default function NeuralShell({ inputs, state = "idle", coreSize = 200, onInput }: {
  inputs: ShellInput[]; state?: CoreState; coreSize?: number; onInput?: (q: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputsRef = useRef(inputs);
  useEffect(() => { inputsRef.current = inputs; }, [inputs]);

  // Divide le card tra colonna sinistra e destra (il core resta al centro).
  const { left, right } = useMemo(() => {
    const half = Math.ceil(inputs.length / 2);
    return { left: inputs.slice(0, half), right: inputs.slice(half) };
  }, [inputs]);

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

    const focus = cssVar("--focus", "#5B74E6");
    const flowCols = [focus, "#38bdf8", "#2dd4bf", "#a78bfa", "#f59e0b", "#f472b6"];

    const parts = Array.from({ length: 70 }, () => ({ side: Math.random() < 0.5 ? 0 : 1, line: 0, t: Math.random(), spd: 0.0026 + Math.random() * 0.0044, r: 1 + Math.random() * 1.8 }));

    let raf = 0, tk = 0;
    // Gli ancoraggi sono i CENTRI reali delle card (misurati dal DOM), così le linee di flusso
    // partono esattamente dal centro di ogni card, qualunque sia altezza/numero.
    const anchors = () => {
      const wr = wrap.getBoundingClientRect();
      const L: { x: number; y: number }[] = [];
      const R: { x: number; y: number }[] = [];
      wrap.querySelectorAll<HTMLElement>("[data-tile]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const cy = r.top - wr.top + r.height / 2;
        if (el.getAttribute("data-side") === "l") L.push({ x: r.right - wr.left, y: cy });
        else R.push({ x: r.left - wr.left, y: cy });
      });
      return { L, R, C: { x: W * 0.5, y: H * 0.52 } };
    };
    const bez = (a: { x: number; y: number }, c: { x: number; y: number }, t: number) => {
      const cpx = (a.x + c.x) / 2, cpy = a.y; const u = 1 - t;
      return { x: u * u * a.x + 2 * u * t * cpx + t * t * c.x, y: u * u * a.y + 2 * u * t * cpy + t * t * c.y };
    };

    const draw = () => {
      tk += 0.016;
      const { L, R, C } = anchors();
      ctx.clearRect(0, 0, W, H);

      const drawSide = (arr: { x: number; y: number }[]) => {
        arr.forEach((a, i) => {
          const col = flowCols[i % flowCols.length];
          ctx.strokeStyle = rgba(col, 0.28); ctx.lineWidth = 1.3;
          ctx.beginPath();
          for (let t = 0; t <= 1; t += 0.05) { const p = bez(a, C, t); if (t === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
          ctx.stroke();
          const pulse = 0.5 + 0.5 * Math.sin(tk * 2 + i);
          ctx.fillStyle = rgba(col, 0.55 + 0.4 * pulse);
          ctx.shadowColor = rgba(col, 0.8); ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(a.x, a.y, 2.6 + 1.6 * pulse, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        });
      };
      drawSide(L); drawSide(R);

      // Particelle bidirezionali
      const nL = L.length, nR = R.length;
      for (const pt of parts) {
        if (!reduce) pt.t += pt.spd;
        const arr = pt.side === 0 ? L : R; const n = arr.length || 1;
        if (pt.t >= 1) { pt.t = 0; pt.side = Math.random() < 0.5 ? 0 : 1; const nn = (pt.side === 0 ? nL : nR) || 1; pt.line = Math.floor(Math.random() * nn); }
        const a = arr[pt.line % n]; if (!a) continue;
        const col = flowCols[(pt.line + (pt.side ? 3 : 0)) % flowCols.length];
        const p = bez(a, C, pt.t);
        const fade = pt.t < 0.1 ? pt.t / 0.1 : pt.t > 0.85 ? (1 - pt.t) / 0.15 : 1;
        ctx.fillStyle = rgba(col, 0.95 * fade);
        ctx.shadowColor = rgba(col, 0.9); ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, pt.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Alone del core (assorbimento)
      const glow = 0.6 + 0.4 * Math.sin(tk * (state === "listen" ? 4 : state === "speak" ? 3 : 1.6));
      const g = ctx.createRadialGradient(C.x, C.y, 0, C.x, C.y, coreSize * 0.75);
      g.addColorStop(0, rgba(focus, 0.16 * glow)); g.addColorStop(1, rgba(focus, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C.x, C.y, coreSize * 0.75, 0, Math.PI * 2); ctx.fill();

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [state, coreSize]);

  const mono = "font-mono";
  const tile = (it: ShellInput, align: "left" | "right") => (
    <button key={it.label} data-tile data-side={align === "left" ? "l" : "r"} onClick={() => it.q && onInput?.(it.q)}
      className={`pointer-events-auto group rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-3 backdrop-blur-md transition hover:border-white/30 hover:bg-white/[0.12] ${align === "right" ? "text-right" : "text-left"}`}
      style={{ boxShadow: "0 2px 14px rgba(0,0,0,.28)" }}>
      <div className={`${mono} text-[9.5px] font-semibold uppercase tracking-wider`} style={{ color: "rgba(200,214,240,.65)" }}>{it.label}</div>
      <div className={`${mono} mt-0.5 text-xl font-bold leading-tight`} style={{ color: it.tone, textShadow: `0 0 16px ${it.tone}55` }}>{it.value}</div>
    </button>
  );

  // Altezza dinamica: la console cresce quanto basta a contenere tutte le card senza scroll.
  const rows = Math.max(left.length, right.length);
  const minH = Math.max(460, 64 + rows * 82);

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-2xl border" style={{ minHeight: minH, borderColor: "rgba(120,140,190,.18)", background: "radial-gradient(120% 90% at 50% 40%, #101827 0%, #0a0f1a 55%, #070b13 100%)" }}>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden />

      {/* Intestazione stile terminale */}
      <div className="relative flex items-center justify-between px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]">
        <span className={mono} style={{ color: "rgba(180,198,230,.75)" }}>XENORA · NEURAL SHELL</span>
        <span className={`${mono} inline-flex items-center gap-1.5`} style={{ color: "#2dd4bf" }}><span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: "#2dd4bf", boxShadow: "0 0 8px #2dd4bf" }} />{state === "listen" ? "ASCOLTO" : state === "speak" ? "OUTPUT" : "LIVE"}</span>
      </div>

      {/* Colonna sinistra (niente scrollbar: l'altezza si adatta) */}
      <div className="pointer-events-none absolute left-0 top-11 bottom-3 z-10 flex w-[40%] flex-col justify-center gap-2.5 px-3 sm:w-[27%]">
        {left.map((it) => tile(it, "left"))}
      </div>
      {/* Colonna destra */}
      <div className="pointer-events-none absolute right-0 top-11 bottom-3 z-10 flex w-[40%] flex-col justify-center gap-2.5 px-3 sm:w-[27%]">
        {right.map((it) => tile(it, "right"))}
      </div>

      {/* Core al CENTRO */}
      <div className="pointer-events-none absolute inset-x-0 top-11 bottom-0 z-0 grid place-items-center">
        <AssistantCore state={state} size={coreSize} />
      </div>
    </div>
  );
}
