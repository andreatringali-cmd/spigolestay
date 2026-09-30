"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useLang } from "@/lib/i18n";

// Icone file Excel/PDF: documento con angolo piegato, colore di brand, senza testo
// (illeggibile a queste dimensioni) — il pittogramma dentro basta a distinguerle.
function ExcelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#1E7145" />
      <path d="M15 2v5h5" fill="#ffffff" opacity="0.35" />
      <path d="M8.2 11.5h1.9l1.4 2.1 1.4-2.1h1.9l-2.35 3.5 2.35 3.5h-1.9l-1.4-2.1-1.4 2.1H8.2l2.35-3.5z" fill="#ffffff" />
    </svg>
  );
}
function PdfIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#E5252A" />
      <path d="M15 2v5h5" fill="#ffffff" opacity="0.35" />
      <text x="12" y="17.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#ffffff" fontFamily="Arial, sans-serif">PDF</text>
    </svg>
  );
}

// Un campo esportabile in Excel: chiave stabile + etichetta mostrata nel picker.
export interface ExportField { key: string; label: string; default?: boolean }

// Pulsante "Esporta" neutro: al click si sceglie Excel o PDF. Il menu si apre sempre verso il basso.
// Se `excelFields` è passato, "Excel" apre prima un picker per scegliere quali campi includere
// (colonne di tabella + dati che stanno solo dentro la scheda, es. email, note, richieste ospite).
export default function ExportMenu({ onExcel, onPdf, excelFields }: { onExcel: (fields?: string[]) => void; onPdf: () => void; excelFields?: ExportField[] }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<Set<string> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const openExcel = () => {
    setOpen(false);
    if (!excelFields) { onExcel(); return; }
    setPicker(new Set(excelFields.filter((f) => f.default !== false).map((f) => f.key)));
  };
  const toggleField = (key: string) => setPicker((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">
        {t("Esporta")} <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-xl">
          <button onClick={openExcel} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-txt hover:bg-wash">
            <ExcelIcon /> Excel
          </button>
          <button onClick={() => { onPdf(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-txt hover:bg-wash">
            <PdfIcon /> PDF
          </button>
        </div>
      )}
      {picker && excelFields && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
          <button aria-label={t("Chiudi")} onClick={() => setPicker(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-txt">{t("Cosa esportare")}</span>
              <button onClick={() => setPicker(null)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
            </div>
            <p className="mb-3 text-xs text-dim">{t("Scegli i dati da includere nel file Excel — anche quelli visibili solo dentro la scheda della prenotazione.")}</p>
            <div className="flex items-center gap-3 border-b border-line pb-2 text-xs font-semibold text-focus">
              <button onClick={() => setPicker(new Set(excelFields.map((f) => f.key)))} className="hover:underline">{t("Tutti")}</button>
              <button onClick={() => setPicker(new Set())} className="hover:underline">{t("Nessuno")}</button>
            </div>
            <div className="mt-2 grid max-h-72 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto pr-1">
              {excelFields.map((f) => (
                <label key={f.key} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-txt hover:bg-wash">
                  <input type="checkbox" checked={picker.has(f.key)} onChange={() => toggleField(f.key)} />
                  {t(f.label)}
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button onClick={() => setPicker(null)} className="ml-auto rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
              <button onClick={() => { onExcel([...picker]); setPicker(null); }} disabled={!picker.size} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Esporta")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
