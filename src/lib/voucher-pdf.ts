import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { et } from "./email-i18n";
import { asGuestLang } from "./guest-i18n";
import { fmtDay, money, countLabel, peopleLabel, normHex, type Lang } from "./mail/shell";
import { pdfSafe } from "./mail/pdf-text";

// Genera il PDF del voucher/conferma prenotazione (A4, carta intestata) da allegare all'email.
// Pure-JS (pdf-lib), gira su Vercel/Node senza dipendenze native. È il RIPIEGO: quando il browser ha già catturato l'anteprima
// reale (VoucherDoc) si allega quella. Lingua = quella dell'email (`lang`); nomi con caratteri fuori WinAnsi → traslitterati (pdf-text.ts).

export interface VoucherData {
  code?: string; structureName?: string; structureEmail?: string; phone?: string; address?: string;
  guestName?: string; guestEmail?: string; roomType?: string; unitName?: string;
  checkIn?: string; checkOut?: string; nights?: number; adults?: number; children?: number;
  total?: number; currency?: string; checkInFrom?: string; checkOutBy?: string;
  color?: string; ratePlan?: string; cancelPolicy?: string; manageUrl?: string;
  logo?: string; website?: string; cin?: string; vat?: string;
  /** Lingua del documento (default italiano). */
  lang?: string;
  /** confirmed | tentative | cancelled | no_show: cambia il titolo ("Conferma di prenotazione" solo se confermata). */
  statusKey?: string;
  /** Prenotazione di gruppo: una riga per camera. */
  rooms?: { roomType?: string; unitName?: string; adults?: number; children?: number; total?: number }[];
  extrasTotal?: number; cleaningFee?: number; bookingTotal?: number; cityTaxAmount?: number; grandTotal?: number; paid?: number; due?: number;
}

function hexRgb(hex?: string) {
  const int = parseInt(normHex(hex, "#285f92").slice(1), 16); // normHex gestisce 3/4/6/8 cifre (alpha escluso)
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}

const W = 595.28, H = 841.89, M = 48;

export async function buildVoucherPdf(b: VoucherData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const S = pdfSafe(font);
  const lang: Lang = asGuestLang(b.lang) ?? "it";
  const T = (s: string) => et(lang, s);
  const accent = hexRgb(b.color);
  const ink = rgb(0.1, 0.12, 0.16);
  const dim = rgb(0.42, 0.46, 0.53);
  const line = rgb(0.9, 0.91, 0.94);
  const cur = b.currency || "€";
  const m = (n?: number) => money(n, cur, lang);

  const status = String(b.statusKey ?? "confirmed");
  const title = status === "tentative" || status === "no_show" ? T("Riepilogo prenotazione") : status === "cancelled" ? T("Prenotazione annullata") : T("Conferma di prenotazione");

  // Logo (se presente): decodificato una volta, disegnato su ogni pagina.
  let logoImg: Awaited<ReturnType<PDFDocument["embedPng"]>> | undefined;
  if (b.logo && /^data:image\//i.test(b.logo)) {
    try {
      const isPng = /^data:image\/png/i.test(b.logo);
      const bytes = Buffer.from(b.logo.split(",")[1] || "", "base64");
      // Prova il formato dichiarato dal data: URI; se pdf-lib lo rifiuta (es. variante JPEG non supportata) prova l'altro formato prima di rinunciare al logo.
      try { logoImg = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); }
      catch { logoImg = isPng ? await doc.embedJpg(bytes) : await doc.embedPng(bytes); }
    } catch (e) { console.error("buildVoucherPdf: logo non incorporabile:", e instanceof Error ? e.message : e); }
  }

  const newPage = (): PDFPage => {
    const page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: accent });
    let textX = M;
    if (logoImg) {
      const box = 56; // riquadro bianco quadrato
      const scale = Math.min(box / logoImg.width, box / logoImg.height);
      const w = logoImg.width * scale, h = logoImg.height * scale;
      const boxY = H - 96 + (96 - box) / 2;
      page.drawRectangle({ x: M, y: boxY, width: box, height: box, color: rgb(1, 1, 1) });
      page.drawImage(logoImg, { x: M + (box - w) / 2, y: boxY + (box - h) / 2, width: w, height: h });
      textX = M + box + 14;
    }
    page.drawText(S(b.structureName || "Xenora"), { x: textX, y: H - 52, size: 22, font: bold, color: rgb(1, 1, 1) });
    page.drawText(S(title), { x: textX, y: H - 74, size: 12, font, color: rgb(1, 1, 1) });
    if (b.code) {
      const codeText = S(b.code);
      const tw = bold.widthOfTextAtSize(codeText, 16);
      page.drawText(S(T("Codice").toUpperCase()), { x: W - M - Math.max(tw, 80), y: H - 46, size: 9, font, color: rgb(1, 1, 1) });
      page.drawText(codeText, { x: W - M - tw, y: H - 68, size: 16, font: bold, color: rgb(1, 1, 1) });
    }
    drawFooter(page);
    return page;
  };

  const drawFooter = (page: PDFPage) => {
    const footY = 60;
    page.drawLine({ start: { x: M, y: footY + 24 }, end: { x: W - M, y: footY + 24 }, thickness: 0.6, color: line });
    const contacts = [b.address, b.phone, b.structureEmail, b.website].filter(Boolean).join("  ·  ");
    const legal = [b.cin ? `CIN ${b.cin}` : "", b.vat ? `${T("P.IVA")} ${b.vat}` : ""].filter(Boolean).join("  ·  ");
    if (contacts) drawCentered(page, S(contacts), footY + 8, 9, font, dim);
    if (legal) drawCentered(page, S(legal), footY - 4, 8, font, dim);
    drawCentered(page, S(T("Documento non fiscale · Generato con Xenora")), legal ? footY - 16 : footY - 6, 8, font, rgb(0.6, 0.64, 0.7));
  };

  let page = newPage();
  let y = H - 140;
  const ensure = (h: number) => { if (y - h < 110) { page = newPage(); y = H - 140; } };

  const wrap = (text: string, f: PDFFont, size: number, maxW: number): string[] => {
    const words = S(text).split(" ");
    let cur2 = ""; const lines: string[] = [];
    for (const w of words) { const t = cur2 ? cur2 + " " + w : w; if (f.widthOfTextAtSize(t, size) > maxW && cur2) { lines.push(cur2); cur2 = w; } else cur2 = t; }
    if (cur2) lines.push(cur2);
    return lines;
  };
  const row = (label: string, value: string, strong = false) => {
    if (!value) return; // riga senza valore (es. nome camera vuoto): omessa
    const size = 11;
    const lines = wrap(value, bold, size, W - M - (M + 150));
    ensure(14 * Math.max(1, lines.length) + 10);
    page.drawText(S(label), { x: M, y, size: 10, font, color: dim });
    lines.forEach((ln, i) => { const tw = bold.widthOfTextAtSize(ln, size); page.drawText(ln, { x: W - M - tw, y: y - i * 14, size, font: bold, color: strong ? accent : ink }); });
    y -= 14 * Math.max(1, lines.length) + 10;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.6, color: line });
  };

  // Ospite
  page.drawText(S(T("Ospite").toUpperCase()), { x: M, y, size: 9, font: bold, color: dim }); y -= 16;
  page.drawText(S(b.guestName || "—"), { x: M, y, size: 13, font: bold, color: ink }); y -= 16;
  if (b.guestEmail) { page.drawText(S(b.guestEmail), { x: M, y, size: 10, font, color: dim }); y -= 14; }
  y -= 12;

  const rooms = (b.rooms || []).filter((r) => [r.roomType, r.unitName].some(Boolean));
  const roomOf = (r: { roomType?: string; unitName?: string }) => [r.roomType, r.unitName].filter(Boolean).join(" · ");
  const n = b.nights ?? 0;
  row(T("Struttura"), b.structureName || "");
  if (rooms.length > 1) rooms.forEach((r) => row(roomOf(r), [peopleLabel(lang, r.adults, r.children), (r.total ?? 0) > 0 ? m(r.total) : ""].filter(Boolean).join(" · ")));
  else row(T("Sistemazione"), roomOf(b));
  row("Check-in", fmtDay(b.checkIn, lang) + (b.checkInFrom ? `  (${T("dalle {time}").replace("{time}", b.checkInFrom)})` : ""));
  row("Check-out", fmtDay(b.checkOut, lang) + (b.checkOutBy ? `  (${T("entro {time}").replace("{time}", b.checkOutBy)})` : ""));
  row(T("Soggiorno"), [n > 0 ? countLabel(lang, "night", n) : "", peopleLabel(lang, b.adults ?? (rooms.length > 1 ? undefined : 1), b.children)].filter(Boolean).join(" · "));
  if (b.ratePlan) row(T("Tariffa"), b.ratePlan);

  // Importi: stessa logica della mail (totale camere, extra, pulizia, tassa separata dal totale prenotazione).
  const extras = b.extrasTotal ?? 0, cleaning = b.cleaningFee ?? 0, tax = b.cityTaxAmount ?? 0, paid = b.paid ?? 0;
  const bookingTotal = b.bookingTotal ?? ((b.total ?? 0) + extras + cleaning);
  const grand = b.grandTotal ?? (bookingTotal + tax);
  const due = b.due ?? Math.max(0, grand - paid);
  if (bookingTotal > 0) {
    if (extras > 0 || cleaning > 0) row(T("Totale camere"), m(b.total));
    if (extras > 0) row(T("Totale extra"), m(extras));
    if (cleaning > 0) row(T("Pulizia"), m(cleaning));
    row(T("Totale prenotazione"), m(bookingTotal), tax <= 0);
    if (tax > 0) { row(T("Tassa di soggiorno"), m(tax)); row(T("Totale con tassa di soggiorno"), m(grand), true); }
    if (paid > 0) row(T("Totale incassato"), m(paid));
    if (status !== "cancelled") row(T("Totale da incassare"), m(due));
  }

  // Condizioni di cancellazione
  if (b.cancelPolicy) {
    const lines = wrap(b.cancelPolicy, font, 10, W - 2 * M);
    ensure(22 + lines.length * 13);
    y -= 8;
    page.drawText(S(T("Condizioni di cancellazione")), { x: M, y, size: 10, font: bold, color: ink }); y -= 14;
    lines.forEach((ln) => { page.drawText(ln, { x: M, y, size: 10, font, color: dim }); y -= 13; });
  }

  return doc.save();
}

function drawCentered(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (W - tw) / 2, y, size, font, color });
}
