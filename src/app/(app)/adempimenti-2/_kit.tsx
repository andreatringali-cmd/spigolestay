"use client";

// Mattoncini grafici di Adempimenti 2: riquadro, anello di avanzamento, barra sottile, numeri che salgono.
// Tutte le animazioni sono sobrie e si spengono con prefers-reduced-motion. Nessuna logica di business qui.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { tint } from "../_ui";
import type { Urgency } from "@/lib/adempimenti2";

/** Ombra morbida dei riquadri: profondità discreta, funziona anche nel tema scuro. */
export const SOFT_SHADOW = "0 1px 2px color-mix(in srgb, var(--txt) 5%, transparent), 0 14px 32px -22px color-mix(in srgb, var(--txt) 26%, transparent)";

/** Significato dei colori: rosso = in ritardo, arancione = da fare oggi, blu = in arrivo, verde = fatto. */
export const URG_COLOR: Record<Urgency, string> = { late: "var(--err)", today: "var(--warn)", soon: "var(--focus)" };
export const toneColor = (t: "ok" | "warn" | "err" | "dim" | "focus"): string => `var(--${t === "dim" ? "faint" : t})`;

const reducedNow = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Passa a true poco dopo il primo disegno: serve a far partire le transizioni (anelli, barre) dopo la comparsa. */
export function useEnter(): { on: boolean; reduced: boolean } {
  const [st, setSt] = useState({ on: false, reduced: false });
  useEffect(() => {
    const reduced = reducedNow();
    const id = requestAnimationFrame(() => setSt({ on: true, reduced }));
    return () => cancelAnimationFrame(id);
  }, []);
  return st;
}

/** Numero che sale fino al valore (si riadatta quando cambia). */
export function CountUp({ value, duration = 800 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    let raf = 0;
    if (reducedNow() || duration <= 0) { raf = requestAnimationFrame(() => { from.current = value; setShown(value); }); return () => cancelAnimationFrame(raf); }
    const a = from.current;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.max(0, Math.min(1, (t - t0) / duration));
      const v = a + (value - a) * (1 - Math.pow(1 - p, 3));
      from.current = v; setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{Math.round(shown)}</>;
}

/** Anello di avanzamento che si disegna all'apertura. */
export function Ring({ pct, color, size = 132, stroke = 8, label, children }: { pct: number; color: string; size?: number; stroke?: number; label: string; children?: ReactNode }) {
  const { on, reduced } = useEnter();
  const r = 50 - stroke / 2 - 1;
  const C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke={tint(color, 14)} strokeWidth={stroke} />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={on ? C * (1 - p / 100) : C} transform="rotate(-90 50 50)" opacity={p > 0 ? 1 : 0}
          style={{ transition: reduced ? "none" : "stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1) .15s, stroke .4s" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Barra sottile che cresce da sinistra. */
export function ThinBar({ pct, color, className = "" }: { pct: number; color: string; className?: string }) {
  const { on, reduced } = useEnter();
  return (
    <div className={`h-1.5 overflow-hidden rounded-full ${className}`} style={{ backgroundColor: tint(color, 14) }}>
      <div className="h-full origin-left rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color, transform: on ? "scaleX(1)" : "scaleX(0)", transition: reduced ? "none" : "transform .9s cubic-bezier(.22,1,.36,1) .1s" }} />
    </div>
  );
}

/** Riquadro base: bordo sottile, ombra morbida, comparsa scalare. */
export function Panel({ children, className = "", delay = 0, style, id, label }: { children: ReactNode; className?: string; delay?: number; style?: CSSProperties; id?: string; label?: string }) {
  return (
    <section id={id} aria-label={label} className={`anim-in min-w-0 rounded-2xl border border-line bg-surface ${className}`} style={{ boxShadow: SOFT_SHADOW, animationDelay: `${delay}ms`, ...style }}>
      {children}
    </section>
  );
}

/** Pulsante primario piccolo (azione di una voce). */
export const BTN_PRIMARY = "inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-focus px-3.5 py-1.5 text-xs font-semibold text-surface shadow-sm transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] disabled:opacity-60";
/** Azione secondaria discreta. */
export const BTN_QUIET = "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-dim transition hover:bg-wash hover:text-txt focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)] disabled:opacity-60";
