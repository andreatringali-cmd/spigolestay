// Testo sicuro per i PDF disegnati con pdf-lib e i font standard (Helvetica): quei font codificano solo WinAnsi (Latin-1 + qualche simbolo),
// e drawText/widthOfTextAtSize LANCIANO un errore su un carattere fuori set (Łukasz, Nguyễn, 李雷, frecce →). Qui ogni carattere non codificabile
// è sostituito dalla lettera base senza segni (Ł→L, ễ→e) o, se non esiste, da "?"; il resto resta com'è (é, ü, ñ, €, ·…).
import type { PDFFont } from "pdf-lib";

const EXTRA: Record<string, string> = {
  "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "ı": "i", "İ": "I", "Ħ": "H", "ħ": "h", "Ŧ": "T", "ŧ": "t", "Ø": "O", "ø": "o", "Æ": "AE", "æ": "ae",
  "ẞ": "SS", "→": "->", "←": "<-", "−": "-", "‑": "-", "‐": "-", "✓": "v", "★": "*",
  " ": " ", " ": " ", " ": " ", "​": "", "‌": "", "‍": "", "﻿": "", // spazi speciali e caratteri invisibili
};

/** Versione del testo che il font può disegnare senza errori. */
export function pdfSafeText(supported: ReadonlySet<number>, text: string): string {
  let out = "";
  for (const ch of String(text ?? "")) {
    const cp = ch.codePointAt(0)!;
    if (cp === 10 || cp === 13 || cp === 9) { out += " "; continue; }
    if (supported.has(cp)) { out += ch; continue; }
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (base && base !== ch && [...base].every((c) => supported.has(c.codePointAt(0)!))) { out += base; continue; }
    const ex = EXTRA[ch];
    if (ex !== undefined) { out += ex; continue; }
    out += out.endsWith("?") ? "" : "?"; // un solo "?" per una serie di caratteri non rappresentabili (es. nome in ideogrammi)
  }
  return out;
}

const SETS = new WeakMap<PDFFont, Set<number>>();
/** Funzione `S(testo)` legata a un font: `S("Nguyễn")` → "Nguyen". */
export function pdfSafe(font: PDFFont): (text: string) => string {
  let set = SETS.get(font);
  if (!set) { set = new Set(font.getCharacterSet()); SETS.set(font, set); }
  const s = set;
  return (text: string) => pdfSafeText(s, text);
}
