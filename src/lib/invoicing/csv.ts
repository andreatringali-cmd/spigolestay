// CSV pensato per Excel italiano / commercialista: separatore ";", decimali con la virgola,
// BOM UTF-8 (accenti corretti), celle sempre tra virgolette. Pura: la parte "download" è separata.

/**
 * Protezione da "CSV injection": un testo che inizia con = + - @ (o tab/ritorno a capo) verrebbe eseguito come formula da Excel/Fogli.
 * Lo si fa precedere da un apostrofo. I numeri veri (tipo number, o testo come "-12,50" / "-1.234,50" / "+393331234567": solo cifre, punti
 * delle migliaia e al massimo una virgola decimale) restano intatti. Un testo con spazi o altri simboli, come un telefono "+39 333 1234567",
 * riceve l'apostrofo anche se non è una formula: in Excel compare come testo (con l'apostrofo visibile), scelta voluta, sicurezza prima.
 */
export function csvSafe(v: unknown): string {
  const s = String(v ?? "");
  if (typeof v === "number") return s;
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?(?=[\d.]*\d)[\d.]+(,\d+)?$/.test(s)) return "'" + s;
  return s;
}

export const csvCell = (v: unknown): string => `"${csvSafe(v).replace(/"/g, '""')}"`;

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
