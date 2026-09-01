"use client";

import { useEffect, useRef, useState } from "react";

// Campo data con calendario personalizzato che si apre SEMPRE verso il basso.
const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const DOW = ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"];
const pad = (n: number) => String(n).padStart(2, "0");

export default function DateField({
  value,
  onChange,
  className = "",
  title,
  placeholder = "gg/mm/aaaa",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  title?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(() => (value ? new Date(value + "T00:00") : new Date()));

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, []);
  useEffect(() => { if (open && value) setView(new Date(value + "T00:00")); }, [open, value]);

  const y = view.getFullYear(), m = view.getMonth();
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7; // Lunedì = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const iso = (d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const todayIso = (() => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; })();
  const display = value ? new Date(value + "T00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) : placeholder;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} title={title} className={`flex items-center gap-1.5 ${className}`}>
        <span className={value ? "text-txt" : "text-faint"}>{display}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0 text-dim"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-line bg-surface p-2 shadow-xl">
          <div className="mb-1 flex items-center justify-between px-1">
            <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} aria-label="Mese precedente" className="grid h-7 w-7 place-items-center rounded-lg text-lg leading-none text-dim hover:bg-wash">‹</button>
            <span className="text-sm font-semibold capitalize text-txt">{MONTHS[m]} {y}</span>
            <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} aria-label="Mese successivo" className="grid h-7 w-7 place-items-center rounded-lg text-lg leading-none text-dim hover:bg-wash">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DOW.map((d) => <span key={d} className="py-1 text-[10px] font-semibold text-faint">{d}</span>)}
            {cells.map((d, i) => d === null ? <span key={i} /> : (
              <button key={i} type="button" onClick={() => { onChange(iso(d)); setOpen(false); }} className={`grid h-7 place-items-center rounded-lg text-xs transition ${value === iso(d) ? "bg-focus font-semibold text-white" : iso(d) === todayIso ? "font-semibold text-focus hover:bg-wash" : "text-txt hover:bg-wash"}`}>{d}</button>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            <button type="button" onClick={() => { onChange(todayIso); setOpen(false); }} className="flex-1 rounded-lg py-1 text-[11px] font-medium text-focus hover:bg-wash">Oggi</button>
            {value && <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="flex-1 rounded-lg py-1 text-[11px] text-dim hover:bg-wash">Cancella</button>}
          </div>
        </div>
      )}
    </div>
  );
}
