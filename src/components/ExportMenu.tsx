"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useLang } from "@/lib/i18n";

// Pulsante "Esporta" neutro: al click si sceglie Excel o PDF. Il menu si apre sempre verso il basso.
export default function ExportMenu({ onExcel, onPdf }: { onExcel: () => void; onPdf: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">
        {t("Esporta")} <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-xl">
          <button onClick={() => { onExcel(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-txt hover:bg-wash">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: "#1E7145" }} /> Excel
          </button>
          <button onClick={() => { onPdf(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-txt hover:bg-wash">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: "#E5252A" }} /> PDF
          </button>
        </div>
      )}
    </div>
  );
}
