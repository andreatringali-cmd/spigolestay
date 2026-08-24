// Export Excel (.xls via tabella HTML, la apre Excel) e PDF (stampa → Salva come PDF).

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function exportExcel(filename: string, headers: string[], rows: (string | number)[][]) {
  const thead = `<tr>${headers.map((h) => `<th style="background:#eee;text-align:left">${esc(h)}</th>`).join("")}</tr>`;
  const tbody = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1" cellspacing="0">${thead}${tbody}</table></body></html>`;
  downloadBlob(new Blob([html], { type: "application/vnd.ms-excel" }), filename.endsWith(".xls") ? filename : `${filename}.xls`);
}

export function exportPdf() {
  window.print();
}
