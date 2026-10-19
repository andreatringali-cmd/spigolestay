"use client";

import { useEffect, useRef, useState } from "react";
import { fmtDMY } from "@/lib/dates";
import Popover from "./Popover";

// Campo data con calendario personalizzato (tendina ancorata al campo: sotto, o sopra se sotto non c'è spazio; mai fuori dallo schermo, anche a 320px).
// Testi del calendario nelle lingue dell'ospite (it · en · fr · de · es); `lang` assente = italiano, come prima.
const CAL: Record<string, { months: string[]; dow: string[]; today: string; clear: string; prev: string; next: string }> = {
  it: { months: ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"], dow: ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"], today: "Oggi", clear: "Cancella", prev: "Mese precedente", next: "Mese successivo" },
  en: { months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], dow: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"], today: "Today", clear: "Clear", prev: "Previous month", next: "Next month" },
  fr: { months: ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"], dow: ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"], today: "Aujourd'hui", clear: "Effacer", prev: "Mois précédent", next: "Mois suivant" },
  de: { months: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"], dow: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], today: "Heute", clear: "Löschen", prev: "Voriger Monat", next: "Nächster Monat" },
  es: { months: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"], dow: ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"], today: "Hoy", clear: "Borrar", prev: "Mes anterior", next: "Mes siguiente" },
};
const pad = (n: number) => String(n).padStart(2, "0");

export default function DateField({
  value,
  onChange,
  className = "",
  title,
  placeholder = "gg.mm.aaaa",
  min,
  max,
  disabled = false,
  id,
  required = false,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  title?: string;
  placeholder?: string;
  min?: string; // yyyy-mm-dd: giorni prima sono disattivati
  max?: string; // yyyy-mm-dd: giorni dopo sono disattivati
  disabled?: boolean;
  id?: string;
  required?: boolean;
  lang?: string; // it · en · fr · de · es: mesi, giorni e pulsanti del calendario nella lingua dell'ospite (assente = italiano)
}) {
  const cal = CAL[(lang || "it").slice(0, 2).toLowerCase()] ?? CAL.it;
  const MONTHS = cal.months, DOW = cal.dow;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState(() => (value ? new Date(value + "T00:00") : new Date()));

  // All'apertura: mese del valore selezionato, o il mese di OGGI se il campo è vuoto — senza
  // questo, un campo svuotato restava fermo sull'ultimo mese aperto (es. gennaio) invece che oggi.
  useEffect(() => { if (open) setView(value ? new Date(value + "T00:00") : new Date()); }, [open, value]);

  const y = view.getFullYear(), m = view.getMonth();
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7; // Lunedì = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const iso = (d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const todayIso = (() => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; })();
  const display = value ? fmtDMY(value) : placeholder;
  const out = (d: number) => (!!min && iso(d) < min) || (!!max && iso(d) > max);

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="relative">
      <button ref={btnRef} type="button" id={id} aria-required={required || undefined} disabled={disabled} onClick={() => setOpen((o) => !o)} title={title} className={`flex items-center gap-1.5 ${className}`}>
        <span className={value ? "text-txt" : "text-faint"}>{display}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0 text-dim"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)} align="start" width={256} className="p-2" label={cal.months[m]}>
          <div className="mb-1 flex items-center justify-between px-1">
            <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} aria-label={cal.prev} className="grid h-7 w-7 place-items-center rounded-lg text-lg leading-none text-dim hover:bg-wash">‹</button>
            <span className="text-sm font-semibold capitalize text-txt">{MONTHS[m]} {y}</span>
            <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} aria-label={cal.next} className="grid h-7 w-7 place-items-center rounded-lg text-lg leading-none text-dim hover:bg-wash">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DOW.map((d) => <span key={d} className="py-1 text-[10px] font-semibold text-faint">{d}</span>)}
            {cells.map((d, i) => d === null ? <span key={i} /> : (
              <button key={i} type="button" disabled={out(d)} onClick={() => { onChange(iso(d)); setOpen(false); }} className={`grid h-7 place-items-center rounded-lg text-xs transition ${value === iso(d) ? "bg-focus font-semibold text-white" : iso(d) === todayIso ? "font-semibold text-focus hover:bg-wash" : "text-txt hover:bg-wash"}`}>{d}</button>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            <button type="button" disabled={(!!min && todayIso < min) || (!!max && todayIso > max)} onClick={() => { onChange(todayIso); setOpen(false); }} className="flex-1 rounded-lg py-1 text-[11px] font-medium text-focus hover:bg-wash disabled:opacity-40">{cal.today}</button>
            {value && <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="flex-1 rounded-lg py-1 text-[11px] text-dim hover:bg-wash">{cal.clear}</button>}
          </div>
      </Popover>
    </div>
  );
}
