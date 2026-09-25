import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Genera il PDF del preventivo (A4, carta intestata) da allegare all'email.
// Stessa libreria e stesso stile di voucher-pdf.ts (pure-JS pdf-lib, nessuna dipendenza nativa).

export interface QuotePdfRoom { name: string; amount: number }
export interface QuotePdfExtra { name: string; desc?: string; price: number; per?: string }

export interface QuoteData {
  ref?: string; // numero preventivo (es. "12/2026")
  structureName?: string; structureEmail?: string; phone?: string; address?: string;
  guestName?: string; guestEmail?: string;
  checkIn?: string; checkOut?: string; nights?: number; adults?: number; children?: number;
  rooms?: QuotePdfRoom[];
  total?: number; deposit?: number; currency?: string;
  color?: string; logo?: string; website?: string; cin?: string; vat?: string;
  extras?: QuotePdfExtra[]; // servizi extra proposti/selezionati
}

type RGB = ReturnType<typeof rgb>;

const PER_LABEL: Record<string, string> = { stay: "a soggiorno", night: "a notte", day: "a giornata", person: "a persona" };

function hexRgb(hex?: string) {
  const h = (hex || "#285f92").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(n.slice(0, 6) || "285f92", 16);
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}
function tint(c: RGB, amt: number) {
  return rgb(c.red + (1 - c.red) * amt, c.green + (1 - c.green) * amt, c.blue + (1 - c.blue) * amt);
}
function fmtDate(iso?: string) {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; }
}
function drawCentered(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: RGB, W: number) {
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (W - tw) / 2, y, size, font, color });
}
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(" ");
  let cur = ""; const lines: string[] = [];
  for (const w of words) { const t = cur ? cur + " " + w : w; if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}

const W = 595.28, H = 841.89, M = 48;

// Intestazione colorata identica a voucher-pdf.ts: logo in riquadro bianco, nome struttura,
// sottotitolo e un badge in alto a destra (qui il numero di preventivo anziché il codice prenotazione).
async function newPage(doc: PDFDocument, accent: RGB, font: PDFFont, bold: PDFFont, b: QuoteData, subtitle: string, badgeLabel?: string, badgeValue?: string): Promise<PDFPage> {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: accent });
  let textX = M;
  if (b.logo && /^data:image\//i.test(b.logo)) {
    try {
      const isPng = /^data:image\/png/i.test(b.logo);
      const bytes = Buffer.from(b.logo.split(",")[1] || "", "base64");
      // Prova il formato dichiarato dal data: URI; se pdf-lib lo rifiuta (es. variante JPEG non
      // supportata) prova l'altro formato prima di rinunciare al logo.
      let img;
      try { img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); }
      catch { img = isPng ? await doc.embedJpg(bytes) : await doc.embedPng(bytes); }
      const box = 56;
      const scale = Math.min(box / img.width, box / img.height);
      const w = img.width * scale, h = img.height * scale;
      const boxY = H - 96 + (96 - box) / 2;
      page.drawRectangle({ x: M, y: boxY, width: box, height: box, color: rgb(1, 1, 1) });
      page.drawImage(img, { x: M + (box - w) / 2, y: boxY + (box - h) / 2, width: w, height: h });
      textX = M + box + 14;
    } catch (e) { console.error("buildQuotePdf: logo non incorporabile:", e instanceof Error ? e.message : e); }
  }
  page.drawText(b.structureName || "Xenora", { x: textX, y: H - 52, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText(subtitle, { x: textX, y: H - 74, size: 12, font, color: rgb(1, 1, 1) });
  if (badgeLabel && badgeValue) {
    const tw = bold.widthOfTextAtSize(badgeValue, 16);
    page.drawText(badgeLabel, { x: W - M - Math.max(tw, 110), y: H - 46, size: 9, font, color: rgb(1, 1, 1) });
    page.drawText(badgeValue, { x: W - M - tw, y: H - 68, size: 16, font: bold, color: rgb(1, 1, 1) });
  }
  return page;
}

function drawFooter(page: PDFPage, font: PDFFont, dim: RGB, line: RGB, b: QuoteData) {
  const footY = 60;
  page.drawLine({ start: { x: M, y: footY + 24 }, end: { x: W - M, y: footY + 24 }, thickness: 0.6, color: line });
  const contacts = [b.address, b.phone, b.structureEmail, b.website].filter(Boolean).join("  ·  ");
  const legal = [b.cin ? `CIN ${b.cin}` : "", b.vat ? `P.IVA ${b.vat}` : ""].filter(Boolean).join("  ·  ");
  if (contacts) drawCentered(page, contacts, footY + 8, 9, font, dim, W);
  if (legal) drawCentered(page, legal, footY - 4, 8, font, dim, W);
  drawCentered(page, "Documento non fiscale · Generato con Xenora", legal ? footY - 16 : footY - 6, 8, font, rgb(0.6, 0.64, 0.7), W);
}

// Riga etichetta/valore con wrap del valore, identica a voucher-pdf.ts. Ritorna la nuova y.
function row(page: PDFPage, y: number, label: string, value: string, font: PDFFont, bold: PDFFont, ink: RGB, dim: RGB, line: RGB): number {
  if (!value) return y;
  page.drawText(label, { x: M, y, size: 10, font, color: dim });
  const maxW = W - M - (M + 150);
  const size = 11;
  const lines = wrap(value, bold, size, maxW);
  lines.forEach((ln, i) => { const tw = bold.widthOfTextAtSize(ln, size); page.drawText(ln, { x: W - M - tw, y: y - i * 14, size, font: bold, color: ink }); });
  const newY = y - 14 * Math.max(1, lines.length) - 10;
  page.drawLine({ start: { x: M, y: newY + 6 }, end: { x: W - M, y: newY + 6 }, thickness: 0.6, color: line });
  return newY;
}

export async function buildQuotePdf(b: QuoteData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexRgb(b.color);
  const ink = rgb(0.1, 0.12, 0.16);
  const dim = rgb(0.42, 0.46, 0.53);
  const line = rgb(0.9, 0.91, 0.94);
  const cur = b.currency || "€";

  const page1 = await newPage(doc, accent, font, bold, b, "Preventivo", b.ref ? "PREVENTIVO N." : undefined, b.ref);
  let y = H - 140;

  // Ospite
  page1.drawText("OSPITE", { x: M, y, size: 9, font: bold, color: dim }); y -= 16;
  page1.drawText(b.guestName || "—", { x: M, y, size: 13, font: bold, color: ink }); y -= 16;
  if (b.guestEmail) { page1.drawText(b.guestEmail, { x: M, y, size: 10, font, color: dim }); y -= 14; }
  y -= 12;

  y = row(page1, y, "Check-in", fmtDate(b.checkIn), font, bold, ink, dim, line);
  y = row(page1, y, "Check-out", fmtDate(b.checkOut), font, bold, ink, dim, line);
  if (b.nights) y = row(page1, y, "Durata", `${b.nights} nott${b.nights === 1 ? "e" : "i"}`, font, bold, ink, dim, line);
  y = row(page1, y, "Ospiti", `${b.adults ?? 1} adulti${b.children ? ` · ${b.children} bambini` : ""}`, font, bold, ink, dim, line);

  if (b.rooms && b.rooms.length) {
    y -= 6;
    page1.drawText("CAMERE", { x: M, y, size: 9, font: bold, color: dim }); y -= 16;
    for (const r of b.rooms) y = row(page1, y, r.name, `${cur} ${r.amount.toLocaleString("it-IT")}`, font, bold, ink, dim, line);
  }

  // Totale soggiorno: riquadro evidenziato nel colore della struttura (come il riepilogo online).
  if (typeof b.total === "number") {
    y -= 8;
    const boxH = 36;
    page1.drawRectangle({ x: M, y: y - boxH + 12, width: W - 2 * M, height: boxH, color: tint(accent, 0.91) });
    page1.drawText("TOTALE SOGGIORNO", { x: M + 14, y: y - 12, size: 10, font: bold, color: ink });
    const totalStr = `${cur} ${b.total.toLocaleString("it-IT")}`;
    const tw = bold.widthOfTextAtSize(totalStr, 15);
    page1.drawText(totalStr, { x: W - M - 14 - tw, y: y - 14, size: 15, font: bold, color: accent });
    y -= boxH + 14;

    // Acconto/saldo: mostrati solo se l'acconto richiesto è parziale (0 < acconto < totale).
    if (typeof b.deposit === "number" && b.deposit > 0 && b.deposit < b.total) {
      y = row(page1, y, "Acconto richiesto", `${cur} ${b.deposit.toLocaleString("it-IT")}`, font, bold, ink, dim, line);
      y = row(page1, y, "Saldo in struttura", `${cur} ${(b.total - b.deposit).toLocaleString("it-IT")}`, font, bold, ink, dim, line);
    }
  }

  drawFooter(page1, font, dim, line, b);

  // Seconda pagina: servizi extra disponibili/selezionati (se presenti).
  if (b.extras && b.extras.length) {
    const page2 = await newPage(doc, accent, font, bold, b, "Servizi extra disponibili", b.ref ? "PREVENTIVO N." : undefined, b.ref);
    let y2 = H - 140;
    page2.drawText("SERVIZI & ESPERIENZE", { x: M, y: y2, size: 9, font: bold, color: dim }); y2 -= 20;
    for (const e of b.extras) {
      const priceStr = `${cur} ${e.price.toLocaleString("it-IT")}`;
      const perStr = e.per ? (PER_LABEL[e.per] ?? e.per) : "";
      page2.drawText(e.name, { x: M, y: y2, size: 12, font: bold, color: ink });
      const tw = bold.widthOfTextAtSize(priceStr, 12);
      page2.drawText(priceStr, { x: W - M - tw, y: y2, size: 12, font: bold, color: ink });
      if (perStr) { const twp = font.widthOfTextAtSize(perStr, 9); page2.drawText(perStr, { x: W - M - twp, y: y2 - 13, size: 9, font, color: dim }); }
      y2 -= 17;
      if (e.desc) {
        const lines = wrap(e.desc, font, 10, W - 2 * M - 10);
        lines.forEach((ln) => { page2.drawText(ln, { x: M, y: y2, size: 10, font, color: dim }); y2 -= 13; });
      }
      y2 -= 8;
      page2.drawLine({ start: { x: M, y: y2 + 4 }, end: { x: W - M, y: y2 + 4 }, thickness: 0.6, color: line });
      y2 -= 6;
    }
    drawFooter(page2, font, dim, line, b);
  }

  return doc.save();
}
