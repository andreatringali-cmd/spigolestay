"use client";

// Piccoli pezzi condivisi dalla vista "Addetta" (mobile-first: tocchi grandi, testo piccolo, niente a capo nelle celle).
import type { ReactNode } from "react";
import { Modal, buttonClass } from "@/components/ui";
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
export const btnPrimary = buttonClass("primary", "md");
export const btnGhost = buttonClass("secondary", "md");

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface shadow-sm ${className}`}>{children}</div>;
}

/** Finestra a tutta larghezza sul telefono (si apre dal basso), centrata dal tablet in su. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return <Modal open onClose={onClose} title={title} size="md" footer={footer} closeLabel="Chiudi">{children}</Modal>;
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
