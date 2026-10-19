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
  // Celle in formato italiano: date ISO → gg.mm.aaaa; numeri con la virgola, ma letti da Excel come numeri veri (x:num) qualunque sia la lingua del computer.
  const cell = (c: string | number) => {
    if (typeof c === "number" && Number.isFinite(c)) return `<td x:num="${c}">${(Number.isInteger(c) ? String(c) : c.toFixed(2)).replace(".", ",")}</td>`;
    const m = typeof c === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(c) : null;
    return `<td>${esc(m ? `${m[3]}.${m[2]}.${m[1]}` : c)}</td>`;
  };
  const tbody = rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1" cellspacing="0">${thead}${tbody}</table></body></html>`;
  downloadBlob(new Blob([html], { type: "application/vnd.ms-excel" }), filename.endsWith(".xls") ? filename : `${filename}.xls`);
}

export function exportPdf() {
  window.print();
}
