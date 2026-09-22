"use client";

// CENTRO DI COMANDO dell'Assistente Xenora. I numeri REALI della struttura sono strumenti disposti
// attorno al NUCLEO (AssistantCore) e i loro dati confluiscono verso il centro lungo filamenti di luce
// con particelle. Regia UNICA: un solo canvas ambientale (pulviscolo + filamenti) + il canvas del
// nucleo. Lo stato (idle/listen/speak) è letto via ref, così l'effetto non si ricostruisce mai a ogni
// transizione. Theme-aware: greige caldo + terracotta in chiaro (niente azzurrino), notte calda in
// scuro. Responsive: su desktop strumenti a sinistra/destra del nucleo, su mobile nucleo in cima e
// strumenti in griglia sotto. Rispetta prefers-reduced-motion.
import { useEffect, useRef, useMemo, useState } from "react";
import AssistantCore from "./AssistantCore";
import { useTheme } from "@/lib/theme";

export interface ShellInput { label: string; value: string; tone: string; q?: string; spark?: number[] }
type CoreState = "idle" | "listen" | "speak";

function rgba(hex: string, a: number) {
  const h = (hex || "#B65C3C").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${isNaN(r) ? 182 : r},${isNaN(g) ? 92 : g},${isNaN(b) ? 60 : b},${Math.max(0, Math.min(1, a))})`;
}
function cssVar(name: string, fallback: string) {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch { return fallback; }
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export default function NeuralShell({ inputs, state = "idle", onInput }: {
  inputs: ShellInput[]; state?: CoreState; onInput?: (q: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  // Indice della card sotto il puntatore: manda un impulso extra lungo il suo filamento (micro-interazione).
  const hotRef = useRef<number>(-1);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const { theme } = useTheme();
  const light = theme !== "dark";

  // Dimensione del nucleo responsiva rispetto alla larghezza del contenitore.
  const [coreSize, setCoreSize] = useState(220);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const upd = () => { const w = el.clientWidth; setCoreSize(Math.round(clamp(w * 0.26, 168, 300))); };
    upd();
    const ro = new ResizeObserver(upd); ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

    const focus = cssVar("--focus", light ? "#2F6BB0" : "#6FA3DC");
    // Filamenti: neutri greige caldi in chiaro (niente azzurrino), ambra/terracotta in scuro.
    const flowCols = light
      ? ["#B4AC9E", "#A89F90", "#C39A6A", "#9C9488", "#B78A5A", "#8C857A"]
      : ["#E08A5B", "#E7B968", "#C9A15E", "#B78A5A", "#A88B6A", focus];
    const moteCol = light ? "#A89F90" : "#E7B968";

    // Pulviscolo ambientale (deriva lenta, molto discreto).
    const motes = Array.from({ length: 26 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.4,
      dx: (Math.random() - 0.5) * 0.00025, dy: (Math.random() - 0.5) * 0.00025, ph: Math.random() * 6.28,
    }));
    // Particelle sui filamenti.
    const parts = Array.from({ length: 56 }, () => ({ side: Math.random() < 0.5 ? 0 : 1, line: 0, t: Math.random(), spd: 0.002 + Math.random() * 0.0036, r: 0.9 + Math.random() * 1.5 }));

    // Ancoraggi: per ogni card, il punto del suo rettangolo più vicino al centro del nucleo → i
    // filamenti funzionano naturalmente sia in layout affiancato (desktop) sia impilato (mobile).
    type A = { x: number; y: number; i: number; side: number };
    const anchors = () => {
      const wr = wrap.getBoundingClientRect();
      const cEl = coreRef.current?.getBoundingClientRect();
      const C = cEl
        ? { x: cEl.left - wr.left + cEl.width / 2, y: cEl.top - wr.top + cEl.height / 2 }
        : { x: W * 0.5, y: H * 0.5 };
      const L: A[] = [], R: A[] = [];
      wrap.querySelectorAll<HTMLElement>("[data-tile]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const x0 = r.left - wr.left, y0 = r.top - wr.top;
        const nx = clamp(C.x, x0, x0 + r.width), ny = clamp(C.y, y0, y0 + r.height);
        const idx = Number(el.getAttribute("data-i")) || 0;
        const a: A = { x: nx, y: ny, i: idx, side: el.getAttribute("data-side") === "l" ? 0 : 1 };
        (a.side === 0 ? L : R).push(a);
      });
      return { L, R, C };
    };
    const bez = (a: { x: number; y: number }, c: { x: number; y: number }, cp: { x: number; y: number }, t: number) => {
      const u = 1 - t;
      return { x: u * u * a.x + 2 * u * t * cp.x + t * t * c.x, y: u * u * a.y + 2 * u * t * cp.y + t * t * c.y };
    };
    const ctrl = (a: { x: number; y: number }, c: { x: number; y: number }) => {
      const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
      const dx = c.x - a.x, dy = c.y - a.y, len = Math.hypot(dx, dy) || 1;
      const off = Math.min(38, len * 0.16);
      return { x: mx + (-dy / len) * off, y: my + (dx / len) * off };
    };

    let raf = 0, tk = 0;
    const draw = () => {
      tk += 0.016;
      const { L, R, C } = anchors();
      const st = stateRef.current;
      const speed = st === "listen" ? 1.6 : st === "speak" ? 1.25 : 1;
      ctx.clearRect(0, 0, W, H);

      // ── Pulviscolo ambientale ──
      for (const m of motes) {
        if (!reduce) { m.x += m.dx; m.y += m.dy; if (m.x < 0) m.x = 1; if (m.x > 1) m.x = 0; if (m.y < 0) m.y = 1; if (m.y > 1) m.y = 0; }
        const tw = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(tk * 1.3 + m.ph));
        ctx.fillStyle = rgba(moteCol, (light ? 0.22 : 0.3) * tw);
        ctx.beginPath(); ctx.arc(m.x * W, m.y * H, m.r, 0, Math.PI * 2); ctx.fill();
      }

      const all = [...L, ...R];
      const cpFor = (a: A) => ctrl(a, C);

      // ── Filamenti (curve dal centro card verso il nucleo) ──
      all.forEach((a) => {
        const col = flowCols[a.i % flowCols.length];
        const cp = cpFor(a);
        const hot = hotRef.current === a.i;
        ctx.strokeStyle = rgba(col, (light ? 0.3 : 0.26) * (hot ? 1.8 : 1));
        ctx.lineWidth = hot ? 1.6 : 1;
        ctx.beginPath();
        for (let t = 0; t <= 1; t += 0.05) { const p = bez(a, C, cp, t); if (t === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
        ctx.stroke();
        // Nodo pulsante all'ancoraggio
        const pulse = 0.5 + 0.5 * Math.sin(tk * 1.8 + a.i);
        ctx.fillStyle = rgba(col, 0.55 + 0.4 * pulse);
        if (!light) { ctx.shadowColor = rgba(col, 0.7); ctx.shadowBlur = 6; }
        ctx.beginPath(); ctx.arc(a.x, a.y, 1.8 + 1.2 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      });

      // ── Particelle che scorrono lungo i filamenti verso il nucleo ──
      for (const pt of parts) {
        const arr = pt.side === 0 ? L : R; const n = arr.length;
        if (n === 0) continue;
        if (!reduce) pt.t += pt.spd * speed;
        if (pt.t >= 1) { pt.t = 0; pt.side = Math.random() < 0.5 ? 0 : 1; const nn = (pt.side === 0 ? L : R).length || 1; pt.line = Math.floor(Math.random() * nn); }
        const a = arr[pt.line % n]; if (!a) continue;
        const cp = cpFor(a);
        const boost = hotRef.current === a.i ? 1.9 : 1;
        const p = bez(a, C, cp, pt.t);
        const fade = pt.t < 0.1 ? pt.t / 0.1 : pt.t > 0.82 ? (1 - pt.t) / 0.18 : 1;
        const col = flowCols[a.i % flowCols.length];
        ctx.fillStyle = rgba(col, (light ? 0.8 : 0.92) * fade);
        ctx.shadowColor = rgba(col, light ? 0.5 : 0.85); ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(p.x, p.y, pt.r * boost, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [light, coreSize]);

  const tile = (it: ShellInput, i: number, align: "left" | "right") => (
    <button
      key={it.label}
      data-tile data-side={align === "left" ? "l" : "r"} data-i={i}
      onClick={() => it.q && onInput?.(it.q)}
      onMouseEnter={() => { hotRef.current = i; }}
      onMouseLeave={() => { hotRef.current = -1; }}
      className={`group relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left backdrop-blur-md transition-all duration-300 ${
        light
          ? "border-black/[0.06] bg-white/55 hover:-translate-y-0.5 hover:border-[color:var(--focus)]/30 hover:bg-white/85"
          : "border-white/10 bg-white/[0.045] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.09]"
      }`}
      style={{ boxShadow: light ? "0 1px 2px rgba(60,54,44,.06), 0 10px 22px -14px rgba(60,54,44,.28)" : "0 1px 2px rgba(0,0,0,.35), 0 12px 26px -16px rgba(0,0,0,.65)" }}
    >
      {/* riflesso vetro in alto */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: light ? "linear-gradient(90deg, transparent, rgba(255,255,255,.9), transparent)" : "linear-gradient(90deg, transparent, rgba(255,255,255,.16), transparent)" }} />
      {/* barra di tono a sinistra (identità cromatica del dato) */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-xl opacity-70 transition-opacity duration-300 group-hover:opacity-100" style={{ backgroundColor: it.tone }} />
      <div className="pl-1.5">
        <div className="font-mono text-[9px] font-semibold uppercase leading-none tracking-[0.14em]" style={{ color: light ? "rgba(114,109,100,.9)" : "rgba(200,194,184,.6)" }}>{it.label}</div>
        <div className="mt-1.5 font-mono text-[21px] font-bold leading-none tabular-nums" style={{ color: it.tone, textShadow: light ? "none" : `0 0 16px ${it.tone}40` }}>{it.value}</div>
        {it.spark && it.spark.length > 1 && (() => {
          const max = Math.max(1, ...it.spark!); const n = it.spark!.length; const w = n * 4;
          return (
            <svg viewBox={`0 0 ${w} 18`} preserveAspectRatio="none" className="mt-2 h-3.5 w-full opacity-80 transition-opacity duration-300 group-hover:opacity-100" aria-hidden>
              {it.spark!.map((v, k) => { const h = Math.max(1.2, (v / max) * 16); return <rect key={k} x={k * 4} y={18 - h} width={2.4} height={h} rx={1.2} fill={it.tone} opacity={0.24 + 0.6 * (v / max)} />; })}
            </svg>
          );
        })()}
      </div>
    </button>
  );

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-3xl border"
      style={{
        borderColor: light ? "rgba(160,152,138,.42)" : "rgba(120,110,95,.24)",
        background: light
          ? "radial-gradient(130% 100% at 50% 32%, #FCFBF9 0%, #F1EEE9 50%, #E6E1D9 100%)"
          : "radial-gradient(130% 100% at 50% 32%, #1B1510 0%, #120D09 55%, #0B0805 100%)",
        boxShadow: light
          ? "0 1px 0 rgba(255,255,255,.7) inset, 0 24px 56px -30px rgba(60,54,44,.4)"
          : "0 1px 0 rgba(255,255,255,.05) inset, 0 28px 64px -34px rgba(0,0,0,.75)",
      }}
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden />

      {/* Intestazione tipo console */}
      <div className="relative flex items-center justify-between px-4 py-3 sm:px-5">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: light ? "rgba(90,85,76,.9)" : "rgba(210,200,188,.75)" }}>
          <span aria-hidden className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: light ? "#B65C3C" : "#E08A5B" }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: light ? "rgba(199,149,68,.8)" : "#E7B968" }} />
          </span>
          XENORA · CENTRO DI COMANDO
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: light ? "#A0632F" : "#E7B968" }}>
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: light ? "#B65C3C" : "#E08A5B", boxShadow: light ? "0 0 8px rgba(182,92,60,.5)" : "0 0 8px rgba(224,138,91,.8)" }} />
          {state === "listen" ? "ASCOLTO" : state === "speak" ? "RISPOSTA" : "LIVE"}
        </span>
      </div>
      <div aria-hidden className="relative mx-4 h-px sm:mx-5" style={{ background: light ? "linear-gradient(90deg, transparent, rgba(182,92,60,.28), transparent)" : "linear-gradient(90deg, transparent, rgba(224,138,91,.3), transparent)" }} />

      {/* Composizione: strumenti / NUCLEO / strumenti.
          mobile: colonna (nucleo in cima, poi due griglie 2-col). desktop: tre zone affiancate. */}
      <div className="relative z-10 grid items-center gap-4 px-4 py-6 sm:px-5 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-6 md:py-8">
        {/* Nucleo (primo su mobile) */}
        <div ref={coreRef} className="order-first flex items-center justify-center md:order-none md:col-start-2">
          <AssistantCore state={state} size={coreSize} />
        </div>
        {/* Strumenti sinistra */}
        <div className="order-2 grid grid-cols-2 gap-2.5 md:order-none md:col-start-1 md:row-start-1 md:grid-cols-1">
          {left.map((it, i) => tile(it, i, "left"))}
        </div>
        {/* Strumenti destra */}
        <div className="order-3 grid grid-cols-2 gap-2.5 md:order-none md:col-start-3 md:row-start-1 md:grid-cols-1">
          {right.map((it, i) => tile(it, left.length + i, "right"))}
        </div>
      </div>
    </div>
  );
}
