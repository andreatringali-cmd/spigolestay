import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Genera il PDF del voucher/conferma prenotazione (A4, carta intestata) da allegare all'email.
// Pure-JS (pdf-lib), gira su Vercel/Node senza dipendenze native.

export interface VoucherData {
  code?: string; structureName?: string; structureEmail?: string; phone?: string; address?: string;
  guestName?: string; guestEmail?: string; roomType?: string; unitName?: string;
  checkIn?: string; checkOut?: string; nights?: number; adults?: number; children?: number;
  total?: number; currency?: string; checkInFrom?: string; checkOutBy?: string;
  color?: string; ratePlan?: string; cancelPolicy?: string; manageUrl?: string;
  logo?: string; website?: string; cin?: string; vat?: string;
}

function hexRgb(hex?: string) {
  const h = (hex || "#285f92").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(n.slice(0, 6) || "285f92", 16);
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}
function fmtDate(iso?: string) {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; }
}

export async function buildVoucherPdf(b: VoucherData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexRgb(b.color);
  const ink = rgb(0.1, 0.12, 0.16);
  const dim = rgb(0.42, 0.46, 0.53);
  const line = rgb(0.9, 0.91, 0.94);
  const W = 595.28;
  const M = 48; // margine
  const cur = b.currency || "€";

  // Intestazione colorata (carta intestata)
  page.drawRectangle({ x: 0, y: 841.89 - 96, width: W, height: 96, color: accent });
  // Logo della struttura (se presente): riquadro bianco a sinistra, testo spostato a destra.
  let textX = M;
  if (b.logo && /^data:image\//i.test(b.logo)) {
    try {
      const isPng = /^data:image\/png/i.test(b.logo);
      const bytes = Buffer.from(b.logo.split(",")[1] || "", "base64");
      const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const box = 56; // riquadro bianco quadrato
      const scale = Math.min(box / img.width, box / img.height);
      const w = img.width * scale, h = img.height * scale;
      const boxY = 841.89 - 96 + (96 - box) / 2;
      page.drawRectangle({ x: M, y: boxY, width: box, height: box, color: rgb(1, 1, 1) });
      page.drawImage(img, { x: M + (box - w) / 2, y: boxY + (box - h) / 2, width: w, height: h });
      textX = M + box + 14;
    } catch { /* logo non valido: si continua col solo testo */ }
  }
  page.drawText(b.structureName || "Xenora", { x: textX, y: 841.89 - 52, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Conferma di prenotazione", { x: textX, y: 841.89 - 74, size: 12, font, color: rgb(1, 1, 1) });
  if (b.code) {
    const codeText = b.code;
    const tw = bold.widthOfTextAtSize(codeText, 16);
    page.drawText("CODICE", { x: W - M - Math.max(tw, 80), y: 841.89 - 46, size: 9, font, color: rgb(1, 1, 1) });
    page.drawText(codeText, { x: W - M - tw, y: 841.89 - 68, size: 16, font: bold, color: rgb(1, 1, 1) });
  }

  let y = 841.89 - 140;
  const row = (label: string, value: string) => {
    if (!value) return;
    page.drawText(label, { x: M, y, size: 10, font, color: dim });
    // valore a destra, con wrap semplice se lungo
    const maxW = W - M - (M + 150);
    const size = 11;
    const words = value.split(" ");
    let curLine = ""; const lines: string[] = [];
    for (const w of words) { const t = curLine ? curLine + " " + w : w; if (bold.widthOfTextAtSize(t, size) > maxW && curLine) { lines.push(curLine); curLine = w; } else curLine = t; }
    if (curLine) lines.push(curLine);
    lines.forEach((ln, i) => { const tw = bold.widthOfTextAtSize(ln, size); page.drawText(ln, { x: W - M - tw, y: y - i * 14, size, font: bold, color: ink }); });
    y -= 14 * Math.max(1, lines.length) + 10;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.6, color: line });
  };

  // Ospite (riquadro)
  page.drawText("OSPITE", { x: M, y, size: 9, font: bold, color: dim }); y -= 16;
  page.drawText(b.guestName || "—", { x: M, y, size: 13, font: bold, color: ink }); y -= 16;
  if (b.guestEmail) { page.drawText(b.guestEmail, { x: M, y, size: 10, font, color: dim }); y -= 14; }
  y -= 12;

  row("Struttura", b.structureName || "");
  row("Sistemazione", [b.roomType, b.unitName].filter(Boolean).join(" · "));
  row("Check-in", fmtDate(b.checkIn) + (b.checkInFrom ? `  (dalle ${b.checkInFrom})` : ""));
  row("Check-out", fmtDate(b.checkOut) + (b.checkOutBy ? `  (entro ${b.checkOutBy})` : ""));
  row("Ospiti", `${b.adults ?? 1} adulti${b.children ? ` · ${b.children} bambini` : ""}${b.nights ? ` · ${b.nights} notti` : ""}`);
  if (b.ratePlan) row("Tariffa", b.ratePlan);
  if (typeof b.total === "number" && b.total > 0) row("Totale soggiorno", `${cur} ${b.total.toLocaleString("it-IT")}`);

  // Condizioni di cancellazione
  if (b.cancelPolicy) {
    y -= 8;
    page.drawText("Condizioni di cancellazione", { x: M, y, size: 10, font: bold, color: ink }); y -= 14;
    // wrap
    const size = 10; const maxW = W - 2 * M; const words = b.cancelPolicy.split(" ");
    let curLine = ""; const lines: string[] = [];
    for (const w of words) { const t = curLine ? curLine + " " + w : w; if (font.widthOfTextAtSize(t, size) > maxW && curLine) { lines.push(curLine); curLine = w; } else curLine = t; }
    if (curLine) lines.push(curLine);
    lines.forEach((ln) => { page.drawText(ln, { x: M, y, size, font, color: dim }); y -= 13; });
  }

  // Piè di pagina
  const foot = (page as PDFPage);
  const footY = 60;
  page.drawLine({ start: { x: M, y: footY + 24 }, end: { x: W - M, y: footY + 24 }, thickness: 0.6, color: line });
  const contacts = [b.address, b.phone, b.structureEmail, b.website].filter(Boolean).join("  ·  ");
  const legal = [b.cin ? `CIN ${b.cin}` : "", b.vat ? `P.IVA ${b.vat}` : ""].filter(Boolean).join("  ·  ");
  if (contacts) drawCentered(foot, contacts, footY + 8, 9, font, dim, W);
  if (legal) drawCentered(foot, legal, footY - 4, 8, font, dim, W);
  drawCentered(foot, "Documento non fiscale · Generato con Xenora", legal ? footY - 16 : footY - 6, 8, font, rgb(0.6, 0.64, 0.7), W);

  return doc.save();
}

function drawCentered(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, W: number) {
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (W - tw) / 2, y, size, font, color });
}
