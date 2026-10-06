"use client";

// Mattoncini della Dashboard 2: palette, riquadro con comparsa allo scroll e "spotlight", conteggio animato, anello, mezzo anello,
// sparkline, tooltip dei grafici. Le animazioni sono sobrie e si spengono con prefers-reduced-motion.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { tint } from "../_ui";

// ── Palette Xenora (logo e login): ciano, azzurro, viola, lilla; ambra per gli avvisi, corallo per i ritardi.
// Il blu pieno non domina: si usano gradienti ciano → viola e trasparenze. Il verde resta solo semantico (var(--ok): arrivi, fatto, positivo)
// e il rosso (var(--err)) per partenze. I valori cambiano col tema (vedi CSS sotto).
export const P = { cy: "var(--d2-cy)", az: "var(--d2-az)", vi: "var(--d2-vi)", li: "var(--d2-li)", amb: "var(--d2-am)", cor: "var(--d2-co)" } as const;
export const SERIES = [P.cy, P.vi, P.az, P.li, P.amb];
// Colori per il fondo scuro dell'hero (fissi: l'hero è scuro in entrambi i temi).
export const HERO = { mint: "#6EE7B7", coral: "#FF9C94", lilac: "#CDBBFF", cyan: "#5FD8FF", ink: "#F4F7FF", inkDim: "rgba(235,241,255,.8)" } as const;

const CSS = `
.d2-root{--d2-cy:#00A6E6;--d2-az:#2F72D8;--d2-vi:#7C4FE0;--d2-li:#B85BD0;--d2-am:#C98419;--d2-co:#D9534A}
.dark .d2-root{--d2-cy:#3CCBFF;--d2-az:#6AA6FF;--d2-vi:#A98BFF;--d2-li:#DA9CF0;--d2-am:#F2B24C;--d2-co:#FF8F86}
@keyframes d2-drift{0%{background-position:0% 30%}50%{background-position:100% 70%}100%{background-position:0% 30%}}
@keyframes d2-ping{0%{transform:scale(1);opacity:.5}80%,100%{transform:scale(2.8);opacity:0}}
@keyframes d2-float{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(18px,-12px,0)}}
.d2-drift{background-size:230% 230%;animation:d2-drift 32s ease-in-out infinite}
.d2-float{animation:d2-float 18s ease-in-out infinite}
.d2-live{position:relative;display:inline-block;border-radius:9999px}
.d2-live::after{content:"";position:absolute;inset:0;border-radius:inherit;background:currentColor;animation:d2-ping 1.9s ease-out infinite}
.d2-tile{position:relative;transition:opacity .75s cubic-bezier(.22,1,.36,1),translate .75s cubic-bezier(.22,1,.36,1),transform .28s ease,box-shadow .28s ease,border-color .28s ease}
.d2-tile:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--d2-vi) 40%,var(--line))}
.d2-spot{pointer-events:none;position:absolute;inset:0;border-radius:inherit;opacity:0;transition:opacity .3s;background:radial-gradient(280px circle at var(--mx,50%) var(--my,50%),color-mix(in srgb,var(--d2-cy) 14%,transparent),transparent 70%)}
.d2-tile:hover .d2-spot{opacity:1}
.d2-fade{animation:fadeUp .55s cubic-bezier(.22,1,.36,1) both}
@media (prefers-reduced-motion:reduce){.d2-drift,.d2-float,.d2-live::after,.d2-fade{animation:none!important}.d2-tile,.d2-tile:hover{transition:none!important;transform:none!important}.d2-spot{display:none}}
`;
export function D2Styles() { return <style>{CSS}</style>; }

/** Ombra morbida dei riquadri: profondità discreta, funziona anche nel tema scuro. */
export const SOFT_SHADOW = "0 1px 2px color-mix(in srgb, var(--txt) 5%, transparent), 0 14px 32px -20px color-mix(in srgb, var(--txt) 28%, transparent)";

const reducedNow = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Il riquadro avvisa i suoi grafici quando entra nello schermo: così disegnano l'animazione solo quando si vedono.
const SeenCtx = createContext<boolean | null>(null);

/** on = si può animare verso il valore finale (dopo il primo disegno e, dentro un riquadro, quando è visibile). */
export function useEnter(): { on: boolean; reduced: boolean } {
  const seen = useContext(SeenCtx);
  const [st, setSt] = useState({ mounted: false, reduced: false });
  useEffect(() => {
    const reduced = reducedNow();
    const id = requestAnimationFrame(() => setSt({ mounted: true, reduced }));
    return () => cancelAnimationFrame(id);
  }, []);
  return { on: st.mounted && (seen ?? true), reduced: st.reduced };
}

/** Numero che sale fino al valore (si riadatta quando il valore cambia). */
export function CountUp({ value, format = (n) => String(Math.round(n)), duration = 900, delay = 0 }: { value: number; format?: (n: number) => string; duration?: number; delay?: number }) {
  const seen = useContext(SeenCtx);
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (seen === false) return;
    let raf = 0;
    if (reducedNow() || duration <= 0) { raf = requestAnimationFrame(() => { from.current = value; setShown(value); }); return () => cancelAnimationFrame(raf); }
    const a = from.current;
    const t0 = performance.now() + delay;
    const tick = (t: number) => {
      const p = Math.max(0, Math.min(1, (t - t0) / duration));
      const v = a + (value - a) * (1 - Math.pow(1 - p, 3));
      from.current = v; setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, delay, seen]);
  return <>{format(shown)}</>;
}

/** Anello di avanzamento che si disegna all'apertura. */
export function Ring({ pct, color, colorTo, track, glow, size = 168, stroke = 9, label, children }: { pct: number; color: string; colorTo?: string; track?: string; glow?: string; size?: number | string; stroke?: number; label: string; children?: ReactNode }) {
  const { on, reduced } = useEnter();
  const gid = useId();
  const r = 50 - stroke / 2 - 1;
  const C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" aria-hidden style={glow ? { filter: `drop-shadow(0 0 6px ${glow})` } : undefined}>
        {colorTo && <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor={colorTo} /></linearGradient></defs>}
        <circle cx="50" cy="50" r={r} fill="none" stroke={track ?? tint(color, 14)} strokeWidth={stroke} />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={colorTo ? `url(#${gid})` : color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={on ? C * (1 - p / 100) : C} transform="rotate(-90 50 50)" opacity={p > 0 ? 1 : 0}
          style={{ transition: reduced ? "none" : "stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1) .2s" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Mezzo anello (indicatore di "salute"): si riempie da sinistra a destra. */
export function HalfGauge({ pct, color, width = 148, stroke = 11, label, children }: { pct: number; color: string; width?: number | string; stroke?: number; label: string; children?: ReactNode }) {
  const { on, reduced } = useEnter();
  const p = Math.max(0, Math.min(100, pct)) / 100;
  const d = `M ${stroke / 2 + 2} 50 A ${50 - stroke / 2 - 2} ${50 - stroke / 2 - 2} 0 0 1 ${100 - stroke / 2 - 2} 50`;
  return (
    <div className="relative shrink-0" style={{ width }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 54" className="block w-full overflow-visible" aria-hidden>
        <path d={d} fill="none" stroke={tint(color, 16)} strokeWidth={stroke} strokeLinecap="round" />
        <path d={d} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={on ? 1 - p : 1} opacity={p > 0 ? 1 : 0}
          style={{ transition: reduced ? "none" : "stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1) .15s", filter: `drop-shadow(0 0 4px ${tint(color, 45)})` }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-none">{children}</div>
    </div>
  );
}

/** Mini-grafico a linea con area morbida; la linea si disegna quando entra. */
export function Sparkline({ values, color, h = 24, fill = true, strokeWidth = 1.8, dot = true, label }: { values: number[]; color: string; h?: number; fill?: boolean; strokeWidth?: number; dot?: boolean; label?: string }) {
  const { on, reduced } = useEnter();
  const gid = useId();
  const n = values.length;
  const W = 100;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(2)},${h} L${x(0).toFixed(2)},${h} Z`;
  const last = values[n - 1] ?? 0;
  return (
    <div className="relative w-full" style={{ height: h }} role="img" aria-label={label ?? "Andamento"}>
      <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" className="block h-full w-full overflow-visible" aria-hidden>
        {fill && <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".32" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>}
        {fill && n > 1 && <path d={area} fill={`url(#${gid})`} style={{ opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity .9s ease .5s" }} />}
        {n > 1 && <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray="1" strokeDashoffset={on ? 0 : 1} style={{ transition: reduced ? "none" : "stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1) .15s" }} />}
      </svg>
      {dot && n > 0 && <span className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${(x(n - 1) / W) * 100}%`, top: `${(y(last) / h) * 100}%`, backgroundColor: color, boxShadow: `0 0 0 3px ${tint(color, 28)}`, opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity .4s ease 1s" }} />}
    </div>
  );
}

/** Indicatore "live" che pulsa (per le urgenze). */
export function LiveDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="d2-live shrink-0" style={{ width: size, height: size, backgroundColor: color, color }} aria-hidden />;
}

/** Passaggio del mouse / tocco su un grafico: indice del punto (o della colonna) sotto il dito. */
export function useChartHover(n: number, mode: "point" | "bin" = "point") {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const at = useCallback((e: RPointerEvent) => {
    const el = ref.current; if (!el || n <= 0) return;
    const r = el.getBoundingClientRect();
    const f = r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0;
    setIdx(mode === "point" ? Math.round(f * (n - 1)) : Math.min(n - 1, Math.floor(f * n)));
  }, [n, mode]);
  const bind = { ref, onPointerMove: at, onPointerDown: at, onPointerLeave: () => setIdx(null), onPointerCancel: () => setIdx(null), style: { touchAction: "pan-y" } as CSSProperties };
  return { idx, bind };
}

/** Etichetta flottante di un grafico, posizionata in percentuale sulla larghezza. */
export function Tip({ xPct, children }: { xPct: number; children: ReactNode }) {
  const tx = xPct > 72 ? "-100%" : xPct < 28 ? "0%" : "-50%";
  return (
    <div className="pointer-events-none absolute top-1 z-20 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] leading-tight text-txt shadow-lg" style={{ left: `${xPct}%`, transform: `translateX(${tx})` }} role="status">
      {children}
    </div>
  );
}

/** Riquadro base del mosaico: bordo sottile, ombra morbida, comparsa allo scroll, sollevamento e spotlight al passaggio. */
export function Tile({ children, className = "", delay = 0, style, id, label }: { children: ReactNode; className?: string; delay?: number; style?: CSSProperties; id?: string; label?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (reducedNow() || typeof IntersectionObserver === "undefined") {
      const id2 = requestAnimationFrame(() => { setSeen(true); setSettled(true); });
      return () => cancelAnimationFrame(id2);
    }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.06, rootMargin: "0px 0px -3% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen || settled) return;
    const t = setTimeout(() => setSettled(true), delay + 900);
    return () => clearTimeout(t);
  }, [seen, settled, delay]);
  const move = (e: RPointerEvent<HTMLElement>) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`); el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <SeenCtx.Provider value={seen}>
      <section
        ref={ref} id={id} aria-label={label} onPointerMove={move}
        className={`d2-tile min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`}
        style={{ boxShadow: SOFT_SHADOW, opacity: seen ? 1 : 0, translate: seen ? "0 0" : "0 16px", transitionDelay: settled ? "0s" : `${delay}ms`, ...style }}
      >
        <span className="d2-spot" aria-hidden />
        <div className="relative">{children}</div>
      </section>
    </SeenCtx.Provider>
  );
}

/** Intestazione di riquadro: titolo breve, contatore, azione a destra. */
export function TileHead({ title, sub, right, count }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; count?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-base font-bold leading-tight tracking-tight text-txt">{title}</h2>
          {count !== undefined && <span className="rounded-full bg-wash px-2 py-0.5 font-mono text-[11px] font-bold text-dim">{count}</span>}
        </div>
        {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Link discreto "Apri →" per le intestazioni. */
export function MoreLink({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
  const cls = "inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-focus transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]";
  if (href) return <Link href={href} className={cls}>{children}<Icon name="chevron" size={12} /></Link>;
  return <button type="button" onClick={onClick} className={cls}>{children}<Icon name="chevron" size={12} /></button>;
}

/** Barra sottile che cresce da sinistra. */
export function ThinBar({ pct, color, delay = 0, className = "" }: { pct: number; color: string; delay?: number; className?: string }) {
  const { on, reduced } = useEnter();
  return (
    <div className={`h-1.5 overflow-hidden rounded-full ${className}`} style={{ backgroundColor: tint(color, 14) }}>
      <div className="h-full origin-left rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color, transform: on ? "scaleX(1)" : "scaleX(0)", transition: reduced ? "none" : `transform .9s cubic-bezier(.22,1,.36,1) ${delay}ms` }} />
    </div>
  );
}

/** Colonne verticali che crescono con ritardo scalare (istogrammi e pickup). */
export function Columns({ values, colors, height = 64, gap = 2, highlight, delay = 0, hover }: { values: number[]; colors: string | string[]; height?: number; gap?: number; highlight?: number | null; delay?: number; hover?: number | null }) {
  const { on, reduced } = useEnter();
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end" style={{ height, gap }}>
      {values.map((v, i) => {
        const c = Array.isArray(colors) ? colors[i] ?? colors[colors.length - 1] : colors;
        const act = hover === i || highlight === i;
        return (
          <div key={i} className="flex h-full min-w-0 flex-1 items-end">
            <div
              className="w-full origin-bottom rounded-t-[3px]"
              style={{ height: `${v > 0 ? Math.max(6, (v / max) * 100) : 3}%`, backgroundColor: v > 0 ? c : tint("var(--faint)", 30), opacity: hover != null && !act ? 0.45 : 1, transform: on ? "scaleY(1)" : "scaleY(0)", transition: reduced ? "none" : `transform .7s cubic-bezier(.22,1,.36,1) ${delay + i * 22}ms, opacity .2s` }}
            />
          </div>
        );
      })}
    </div>
  );
}

export const toneColor = (t: "ok" | "warn" | "err" | "dim" | "focus"): string => `var(--${t === "dim" ? "faint" : t})`;
