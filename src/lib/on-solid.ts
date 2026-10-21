// Classe del testo da usare SOPRA uno sfondo pieno quando il colore arriva da una variabile.
// - token di stato ("var(--ok)" ecc.) → coppia text-on-* (bianco in chiaro, quasi-nero in scuro)
// - altri token ("var(--dim)", ...) → coppia dell'accento
// - colori fissi scelti dall'utente (#hex) → bianco, oppure un quasi-nero quando il bianco non arriva a 4,5:1 (giallo, ambra, #fff);
//   per i toni medi dove NESSUNO dei due arriva a 4,5:1 (es. avatar #BE5D38: bianco 4,4 · nero 4,4) lo sfondo va scurito con solidBg(): usare sempre la coppia
//   style={{ backgroundColor: solidBg(c) }} + className={onSolid(c)};
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

const DARK_L = 0.0058; // luminanza di #0F1115 (il testo scuro su fondo pieno)

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function lumOf(rgb: [number, number, number]): number {
  const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** Sfondo pieno leggibile: invariato se il bianco o il quasi-nero arrivano a 4,5:1, altrimenti scurito a passi del 6 % fino a far passare il bianco. Solo per gli #hex. */
export function solidBg(color: string | undefined | null): string | undefined {
  const c = color ?? "";
  const rgb = hexToRgb(c);
  if (!rgb) return color ?? undefined;
  const L = lumOf(rgb);
  if (1.05 / (L + 0.05) >= 4.5 || (L + 0.05) / (DARK_L + 0.05) >= 4.5) return c;
  let cur = rgb;
  for (let i = 0; i < 12; i++) {
    cur = [Math.round(cur[0] * 0.94), Math.round(cur[1] * 0.94), Math.round(cur[2] * 0.94)];
    if (1.05 / (lumOf(cur) + 0.05) >= 4.5) break;
  }
  return "#" + cur.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function onSolid(color: string | undefined | null): string {
  const c = color ?? "";
  if (c.includes("--err")) return "text-on-err";
  if (c.includes("--warn")) return "text-on-warn";
  if (c.includes("--ok")) return "text-on-ok";
  if (c.includes("var(--")) return "text-on-focus";
  const fixed = solidBg(c) ?? c;
  const w = whiteContrastOnHex(fixed);
  if (w !== null && w < 4.5) return "text-[#0F1115]"; // solo se il quasi-nero (#0F1115) passa e il bianco no (giallo, ambra, bianco)
  return "text-white";
}
