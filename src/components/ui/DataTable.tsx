"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "./cn";

// Tabella dati minimale (Xenora DS 1): intestazione 11 px maiuscola su sfondo wash, celle px-3 py-2, righe separate da una linea.
//  - stickyHeader: intestazione che resta in alto; la tabella scorre dentro un contenitore alto al massimo 70 % dello schermo.
//  - onRowClick: le righe diventano cliccabili e raggiungibili da tastiera (Tab, poi Invio o Spazio); hover e focus visibili.
//  - loading: righe «scheletro» e aria-busy; rows vuote: riga con il testo `empty` (stringa o un <EmptyState/> a scelta).
//  - align per colonna: «right» per gli importi (cifre in colonna).
//  - Sul telefono scorre in orizzontale (overflow-x-auto): per elenchi lunghi preferisci comunque una vista a card.
// Uso:
//   <DataTable caption="Pagamenti" rowKey={(r) => r.id} rows={pagamenti} onRowClick={apri}
//     columns={[{ key: "d", header: "Data", cell: (r) => fmtDMY(r.date) }, { key: "i", header: "Importo", align: "right", cell: (r) => eur(r.amount) }]} />
export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Classi aggiuntive su th e td (larghezza, nowrap…). */
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Titolo della tabella per i lettori di schermo (nascosto alla vista). */
  caption?: string;
  stickyHeader?: boolean;
  loading?: boolean;
  /** Quante righe scheletro mostrare mentre carica. */
  loadingRows?: number;
  empty?: ReactNode;
  className?: string;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function DataTable<T>({ columns, rows, rowKey, onRowClick, caption, stickyHeader = false, loading = false, loadingRows = 5, empty = "Nessun dato", className }: DataTableProps<T>) {
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.target !== e.currentTarget) return; // il tasto premuto su un pulsante dentro la riga non deve aprire la riga
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick?.(row); }
  };
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-line bg-surface", stickyHeader && "max-h-[70dvh] overflow-y-auto", className)}>
      <table className="w-full border-collapse text-sm" aria-busy={loading || undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className={cn("bg-wash", stickyHeader && "sticky top-0 z-10")}>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-dim", ALIGN[c.align ?? "left"], c.className)}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: loadingRows }, (_, i) => (
            <tr key={`sk-${i}`} className="border-b border-line last:border-0" aria-hidden="true">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-3"><div className="h-3 w-3/4 animate-pulse rounded bg-wash" /></td>
              ))}
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-dim">{empty}</td></tr>
          )}
          {!loading && rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => onKey(e, r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn("border-b border-line last:border-0", onRowClick && "cursor-pointer hover:bg-wash focus-visible:bg-wash focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus")}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-2 text-txt", ALIGN[c.align ?? "left"], c.className)}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
