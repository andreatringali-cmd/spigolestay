"use client";

// "Neural Shell" dell'Assistente: una CONSOLE elegante in stile HUD. I dati reali entrano da
// SINISTRA e da DESTRA come card glass e fluiscono lungo linee curve con particelle verso il CORE
// J.A.R.V.I.S. al CENTRO. I numeri sono reali, l'animazione è decorativa e discreta.
// Theme-aware: GRIGI neutri caldi (niente azzurrino) su base chiara e premium; console "arc-reactor"
// cyan su base scura.
import { useEffect, useRef, useMemo } from "react";
import AssistantCore from "./AssistantCore";
import { useTheme } from "@/lib/theme";

export interface ShellInput { label: string; value: string; tone: string; q?: string; spark?: number[] }
type CoreState = "idle" | "listen" | "speak";

function rgba(hex: string, a: number) {
  const h = (hex || "#5B74E6").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r || 91},${g || 116},${b || 230},${Math.max(0, Math.min(1, a))})`;
}
function cssVar(name: string, fallback: string) {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch { return fallback; }
}

export default function NeuralShell({ inputs, state = "idle", coreSize = 208, onInput }: {
  inputs: ShellInput[]; state?: CoreState; coreSize?: number; onInput?: (q: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stato letto via ref nel loop di disegno: evita di ricostruire l'effetto canvas (e resettare i
  // flussi) a ogni transizione idle↔listen↔speak.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  // Versione CHIARA e premium in tema chiaro, CONSOLE SCURA in tema scuro.
  const { theme } = useTheme();
  const light = theme !== "dark";

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

    const focus = cssVar("--focus", "#2F6BB0");
    // In tema chiaro: palette di GRIGI neutri CALDI (armonizzati col greige dell'app, niente azzurrino).
    // In scuro: flussi colorati "neural" attorno al cyan.
    const flowCols = light
      ? ["#B8B2A8", "#A69E90", "#8C857A", "#C2BBB0", "#9A9287", "#77716A"]
      : [focus, "#38bdf8", "#2dd4bf", "#a78bfa", "#f59e0b", "#f472b6"];
    const glowCol = light ? "#A69E90" : focus;

    const parts = Array.from({ length: 64 }, () => ({ side: Math.random() < 0.5 ? 0 : 1, line: 0, t: Math.random(), spd: 0.0022 + Math.random() * 0.0038, r: 1 + Math.random() * 1.6 }));

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
          ctx.strokeStyle = rgba(col, light ? 0.32 : 0.24); ctx.lineWidth = 1.1;
          ctx.beginPath();
          for (let t = 0; t <= 1; t += 0.05) { const p = bez(a, C, t); if (t === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
          ctx.stroke();
          const pulse = 0.5 + 0.5 * Math.sin(tk * 1.8 + i);
          ctx.fillStyle = rgba(col, 0.5 + 0.4 * pulse);
          ctx.shadowColor = rgba(col, light ? 0.5 : 0.8); ctx.shadowBlur = 7;
          ctx.beginPath(); ctx.arc(a.x, a.y, 2.2 + 1.4 * pulse, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        });
      };
      drawSide(L); drawSide(R);

      // Particelle bidirezionali (più rade e morbide)
      const nL = L.length, nR = R.length;
      for (const pt of parts) {
        if (!reduce) pt.t += pt.spd;
        const arr = pt.side === 0 ? L : R; const n = arr.length || 1;
        if (pt.t >= 1) { pt.t = 0; pt.side = Math.random() < 0.5 ? 0 : 1; const nn = (pt.side === 0 ? nL : nR) || 1; pt.line = Math.floor(Math.random() * nn); }
        const a = arr[pt.line % n]; if (!a) continue;
        const col = flowCols[(pt.line + (pt.side ? 3 : 0)) % flowCols.length];
        const p = bez(a, C, pt.t);
        const fade = pt.t < 0.1 ? pt.t / 0.1 : pt.t > 0.85 ? (1 - pt.t) / 0.15 : 1;
        ctx.fillStyle = rgba(col, (light ? 0.85 : 0.95) * fade);
        ctx.shadowColor = rgba(col, light ? 0.55 : 0.9); ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(p.x, p.y, pt.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Alone del core (assorbimento)
      const st = stateRef.current;
      const glow = 0.6 + 0.4 * Math.sin(tk * (st === "listen" ? 3.4 : st === "speak" ? 2.6 : 1.4));
      const g = ctx.createRadialGradient(C.x, C.y, 0, C.x, C.y, coreSize * 0.8);
      g.addColorStop(0, rgba(glowCol, (light ? 0.10 : 0.15) * glow)); g.addColorStop(1, rgba(glowCol, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C.x, C.y, coreSize * 0.8, 0, Math.PI * 2); ctx.fill();

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [coreSize, light]);

  const mono = "font-mono";
  const tile = (it: ShellInput, align: "left" | "right") => (
    <button key={it.label} data-tile data-side={align === "left" ? "l" : "r"} onClick={() => it.q && onInput?.(it.q)}
      className={`pointer-events-auto group relative overflow-hidden rounded-xl border px-3.5 py-2.5 backdrop-blur-md transition-all duration-300 ${light ? "border-black/[0.07] bg-white/60 hover:-translate-y-0.5 hover:border-black/[0.16] hover:bg-white/85" : "border-white/10 bg-white/[0.055] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.11]"} ${align === "right" ? "text-right" : "text-left"}`}
      style={{ boxShadow: light ? "0 1px 2px rgba(38,36,31,.05), 0 8px 20px -12px rgba(60,54,44,.25)" : "0 1px 2px rgba(0,0,0,.3), 0 10px 24px -14px rgba(0,0,0,.6)" }}>
      {/* Riflesso sottile in alto per profondità vetro */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: light ? "linear-gradient(90deg, transparent, rgba(255,255,255,.9), transparent)" : "linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent)" }} />
      <div className={`${mono} text-[9px] font-semibold uppercase leading-none tracking-[0.14em]`} style={{ color: light ? "rgba(114,109,100,.85)" : "rgba(200,214,240,.62)" }}>{it.label}</div>
      <div className={`${mono} mt-1.5 text-[22px] font-bold leading-none tabular-nums`} style={{ color: it.tone, textShadow: light ? "none" : `0 0 18px ${it.tone}44` }}>{it.value}</div>
      {it.spark && it.spark.length > 1 && (() => {
        const max = Math.max(1, ...it.spark!); const n = it.spark!.length; const w = n * 4;
        return (
          <svg viewBox={`0 0 ${w} 20`} preserveAspectRatio="none" className="mt-2 h-4 w-full" aria-hidden>
            {it.spark!.map((v, i) => { const h = Math.max(1.2, (v / max) * 18); return <rect key={i} x={i * 4 + (align === "right" ? 1 : 0)} y={20 - h} width={2.4} height={h} rx={1} fill={it.tone} opacity={0.22 + 0.62 * (v / max)} />; })}
          </svg>
        );
      })()}
    </button>
  );

  // Altezza dinamica: la console cresce quanto basta a contenere tutte le card senza scroll.
  const rows = Math.max(left.length, right.length);
  const minH = Math.max(480, 76 + rows * 80);

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-2xl border"
      style={{
        minHeight: minH,
        borderColor: light ? "rgba(160,152,138,.38)" : "rgba(120,140,190,.18)",
        background: light
          ? "radial-gradient(125% 95% at 50% 38%, #FCFBF9 0%, #F1EFEA 52%, #E5E1DA 100%)"
          : "radial-gradient(125% 95% at 50% 38%, #101827 0%, #0A0F1A 55%, #070B13 100%)",
        boxShadow: light
          ? "0 1px 0 rgba(255,255,255,.6) inset, 0 20px 48px -28px rgba(60,54,44,.35)"
          : "0 1px 0 rgba(255,255,255,.05) inset, 0 24px 60px -32px rgba(0,0,0,.7)",
      }}
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden />

      {/* Intestazione stile terminale, con hairline di separazione */}
      <div className="relative flex items-center justify-between px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em]">
        <span className={`${mono} inline-flex items-center gap-2`} style={{ color: light ? "rgba(90,85,76,.85)" : "rgba(180,198,230,.75)" }}>
          <span aria-hidden className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: light ? "rgba(184,147,78,.75)" : "#fbbf24" }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: light ? "rgba(140,133,122,.55)" : "rgba(125,211,252,.55)" }} />
          </span>
          XENORA · NEURAL CONSOLE
        </span>
        <span className={`${mono} inline-flex items-center gap-1.5`} style={{ color: light ? "#0d9488" : "#2dd4bf" }}>
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: light ? "#0d9488" : "#2dd4bf", boxShadow: light ? "0 0 8px #0d948855" : "0 0 8px #2dd4bf" }} />
          {state === "listen" ? "ASCOLTO" : state === "speak" ? "OUTPUT" : "LIVE"}
        </span>
      </div>
      <div aria-hidden className="relative mx-5 h-px" style={{ background: light ? "linear-gradient(90deg, transparent, rgba(160,152,138,.4), transparent)" : "linear-gradient(90deg, transparent, rgba(120,140,190,.2), transparent)" }} />

      {/* Colonna sinistra (niente scrollbar: l'altezza si adatta) */}
      <div className="pointer-events-none absolute left-0 top-14 bottom-4 z-10 flex w-[42%] flex-col justify-center gap-2.5 px-3 sm:w-[27%] sm:px-4">
        {left.map((it) => tile(it, "left"))}
      </div>
      {/* Colonna destra */}
      <div className="pointer-events-none absolute right-0 top-14 bottom-4 z-10 flex w-[42%] flex-col justify-center gap-2.5 px-3 sm:w-[27%] sm:px-4">
        {right.map((it) => tile(it, "right"))}
      </div>

      {/* Core al CENTRO */}
      <div className="pointer-events-none absolute inset-x-0 top-14 bottom-0 z-0 grid place-items-center">
        <AssistantCore state={state} size={coreSize} />
      </div>
    </div>
  );
}
