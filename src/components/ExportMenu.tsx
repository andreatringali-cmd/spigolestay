"use client";

import { useRef, useState } from "react";
import Icon from "./Icon";
import Popover from "./Popover";
import { Button, Modal } from "./ui/index";
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
// Senza `onPdf` il pulsante è uno solo, "Excel" (niente menu): così nelle pagine che esportano solo in Excel non c'è una scelta in più da fare.
export default function ExportMenu({ onExcel, onPdf, excelFields }: { onExcel: (fields?: string[]) => void; onPdf?: () => void; excelFields?: ExportField[] }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<Set<string> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const openExcel = () => {
    setOpen(false);
    if (!excelFields) { onExcel(); return; }
    setPicker(new Set(excelFields.filter((f) => f.default !== false).map((f) => f.key)));
  };
  const toggleField = (key: string) => setPicker((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  return (
    <div className="relative">
      {!onPdf && (
        <Button variant="secondary" size="sm" onClick={openExcel} title="Excel" aria-label="Excel" className="font-medium">
          <ExcelIcon /> <span className="max-sm:sr-only">Excel</span>
        </Button>
      )}
      {onPdf && (<>
      <Button ref={btnRef} variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={t("Esporta")} className="font-medium">
        <span className="max-sm:sr-only">{t("Esporta")}</span> <Icon name="chevron" size={14} />
      </Button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)} align="end" width={160} label={t("Esporta")}>
          <button onClick={openExcel} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-txt hover:bg-wash">
            <ExcelIcon /> Excel
          </button>
          <button onClick={() => { onPdf?.(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-txt hover:bg-wash">
            <PdfIcon /> PDF
          </button>
      </Popover>
      </>)}
      {picker && excelFields && (
        <Modal
          open
          onClose={() => setPicker(null)}
          title={t("Cosa esportare")}
          description={t("Scegli i dati da includere nel file Excel — anche quelli visibili solo dentro la scheda della prenotazione.")}
          size="sm"
          footer={<>
            <Button variant="secondary" onClick={() => setPicker(null)}>{t("Annulla")}</Button>
            <Button onClick={() => { onExcel([...picker]); setPicker(null); }} disabled={!picker.size}>{t("Esporta")}</Button>
          </>}
        >
          <div className="flex items-center gap-3 border-b border-line pb-2 text-xs font-semibold text-focus">
            <button onClick={() => setPicker(new Set(excelFields.map((f) => f.key)))} className="py-1 hover:underline">{t("Tutti")}</button>
            <button onClick={() => setPicker(new Set())} className="py-1 hover:underline">{t("Nessuno")}</button>
          </div>
          <div className="mt-2 grid max-h-72 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto pr-1">
            {excelFields.map((f) => (
              <label key={f.key} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-txt hover:bg-wash">
                <input type="checkbox" checked={picker.has(f.key)} onChange={() => toggleField(f.key)} />
                {t(f.label)}
              </label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
