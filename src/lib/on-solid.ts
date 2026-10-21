// Classe del testo da usare SOPRA uno sfondo pieno quando il colore arriva da una variabile.
// - token di stato ("var(--ok)" ecc.) → coppia text-on-* (bianco in chiaro, quasi-nero in scuro)
// - altri token ("var(--dim)", ...) → coppia dell'accento
// - colori fissi scelti dall'utente (#hex) → bianco, oppure un quasi-nero quando il bianco non arriva a 4,5:1 (es. avatar #BE5D38 = 4,4:1, giallo, ambra);
//   altri formati (rgb, hsl) → bianco, come prima.
// Le classi sono scritte per intero così Tailwind le trova.
/** Contrasto WCAG del bianco su un #rgb/#rrggbb; null se il formato non è un esadecimale. */
export function whiteContrastOnHex(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const lin = (i: number) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return 1.05 / (L + 0.05);
}

export function onSolid(color: string | undefined | null): string {
  const c = color ?? "";
  if (c.includes("--err")) return "text-on-err";
  if (c.includes("--warn")) return "text-on-warn";
  if (c.includes("--ok")) return "text-on-ok";
  if (c.includes("var(--")) return "text-on-focus";
  const w = whiteContrastOnHex(c);
  if (w !== null && w < 4.5) return "text-[#0F1115]"; // il quasi-nero (#0F1115, L≈0,006) ha sempre più contrasto del bianco quando il bianco è sotto 4,5:1
  return "text-white";
}
