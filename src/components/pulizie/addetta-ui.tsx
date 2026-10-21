"use client";

// Piccoli pezzi condivisi dalla vista "Addetta" (mobile-first: tocchi grandi, testo piccolo, niente a capo nelle celle).
import { useEffect, type ReactNode } from "react";
import { toISO } from "@/lib/dates";

export const newId = (): string => ((typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Adesso, nei tre formati che servono: data locale ISO, data+ora locale (senza fuso) e millisecondi. */
export function stamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = toISO(d);
  return { today, iso: `${today}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, ms: d.getTime() };
}
export const hhmm = (iso: string | undefined): string => (iso && iso.length >= 16 ? iso.slice(11, 16) : "");

export const inputCls = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none placeholder:text-faint focus:border-focus";
export const btnPrimary = "rounded-lg bg-focus px-4 py-2.5 text-sm font-semibold text-on-focus hover:opacity-90 disabled:opacity-40";
export const btnGhost = "rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-dim hover:bg-wash";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface shadow-sm ${className}`}>{children}</div>;
}

/** Finestra a tutta larghezza sul telefono (si apre dal basso), centrata dal tablet in su. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button aria-label="Chiudi" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <span className="font-display text-base font-bold text-txt">{title}</span>
          <button onClick={onClose} aria-label="Chiudi" className="grid h-9 w-9 place-items-center rounded-lg text-dim hover:bg-wash hover:text-txt">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-3 block text-xs font-medium text-dim first:mt-0">
      {label}{hint && <span className="font-normal text-faint"> ({hint})</span>}
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Interruttore a pulsanti affiancati (2-4 scelte). */
export function Seg<T extends string>({ value, onChange, options, className = "" }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[]; className?: string }) {
  return (
    <div role="group" className={`flex overflow-hidden rounded-lg border border-line ${className}`}>
      {options.map((o, i) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)} className={`min-h-[40px] flex-1 px-2 text-xs font-semibold transition ${i > 0 ? "border-l border-line" : ""} ${value === o.key ? "bg-focus text-on-focus" : "text-dim hover:bg-wash"}`}>{o.label}</button>
      ))}
    </div>
  );
}
