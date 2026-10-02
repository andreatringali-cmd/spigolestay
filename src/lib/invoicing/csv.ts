// CSV pensato per Excel italiano / commercialista: separatore ";", decimali con la virgola,
// BOM UTF-8 (accenti corretti), celle sempre tra virgolette. Pura: la parte "download" è separata.

export const csvCell = (v: unknown): string => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Importo in centesimi → "1234,50" (senza separatore migliaia, come si aspetta Excel).
export const centsToCsv = (cents: number | null | undefined): string => ((cents ?? 0) / 100).toFixed(2).replace(".", ",");

export function buildCsv(head: string[], rows: (string | number | null | undefined)[][]): string {
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

// Solo browser.
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
