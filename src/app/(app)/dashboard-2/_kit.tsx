"use client";

// Mattoncini della Dashboard 2: riquadro, conteggio animato, anello, intestazioni.
// Tutte le animazioni sono sobrie e si spengono con prefers-reduced-motion.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { tint } from "../_ui";

/** Ombra morbida dei riquadri: profondità discreta, funziona anche nel tema scuro. */
export const SOFT_SHADOW = "0 1px 2px color-mix(in srgb, var(--txt) 5%, transparent), 0 14px 32px -20px color-mix(in srgb, var(--txt) 28%, transparent)";

const reducedNow = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Passa a true poco dopo il primo disegno: serve a far partire transizioni (anelli, barre) dopo la comparsa. */
export function useEnter(): { on: boolean; reduced: boolean } {
  const [st, setSt] = useState({ on: false, reduced: false });
  useEffect(() => {
    const reduced = reducedNow();
    const id = requestAnimationFrame(() => setSt({ on: true, reduced }));
    return () => cancelAnimationFrame(id);
  }, []);
  return st;
}

/** Numero che sale fino al valore (si riadatta quando il valore cambia). */
export function CountUp({ value, format = (n) => String(Math.round(n)), duration = 900, delay = 0 }: { value: number; format?: (n: number) => string; duration?: number; delay?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
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
  }, [value, duration, delay]);
  return <>{format(shown)}</>;
}

/** Anello di avanzamento che si disegna all'apertura. */
export function Ring({ pct, color, size = 168, stroke = 9, label, children }: { pct: number; color: string; size?: number | string; stroke?: number; label: string; children?: ReactNode }) {
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
          style={{ transition: reduced ? "none" : "stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1) .2s" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Riquadro base del mosaico: bordo sottile, ombra morbida, comparsa scalare. */
export function Tile({ children, className = "", delay = 0, style, id, label }: { children: ReactNode; className?: string; delay?: number; style?: CSSProperties; id?: string; label?: string }) {
  return (
    <section id={id} aria-label={label} className={`anim-in min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`} style={{ boxShadow: SOFT_SHADOW, animationDelay: `${delay}ms`, ...style }}>
      {children}
    </section>
  );
}

/** Intestazione di riquadro: titolo, sotto-titolo, azione a destra. */
export function TileHead({ title, sub, right, count }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; count?: ReactNode }) {
  return (
    <div className="mb-3.5 flex items-start justify-between gap-3">
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

export const toneColor = (t: "ok" | "warn" | "err" | "dim" | "focus"): string => `var(--${t === "dim" ? "faint" : t})`;
