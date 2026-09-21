// ============================================================
//  Immagine prodotto per l'e-commerce Forniture.
//  Se il prodotto ha una foto reale (image_url) si usa quella; altrimenti si genera
//  un SEGNAPOSTO SVG originale (gradiente per categoria + glifo + nome), così il
//  catalogo ha già l'aspetto di un negozio. Nessuna immagine di terzi (no copyright).
// ============================================================

// Colore per categoria (coerente con la palette terra dell'app).
const CAT_COLOR: Record<string, string> = {
  "kit-cortesia": "#BE5D38",
  "caffe-macchine": "#7A5230",
  "carta-monouso": "#5E7C8B",
  "pulizia-lavanderia": "#2C8A8A",
  "colazione-camera": "#C08A3A",
  "biancheria": "#957A66",
  "camera-bagno": "#7A8450",
  "segnaletica": "#A65A7A",
  "tech-sicurezza": "#4F46E5",
};
export const categoryColor = (slug?: string) => (slug && CAT_COLOR[slug]) || "#8A6E52";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Spezza il nome su due righe centrate (per il segnaposto).
function twoLines(name: string): [string, string] {
  const words = name.split(/\s+/);
  if (words.length <= 1) return [name, ""];
  let a = ""; let i = 0;
  while (i < words.length && (a + " " + words[i]).trim().length <= 18) { a = (a + " " + words[i]).trim(); i++; }
  const b = words.slice(i).join(" ");
  return [a || name, b];
}

/** Segnaposto prodotto come data URI SVG (400×300). */
export function placeholderImage(name: string, categorySlug?: string): string {
  const color = categoryColor(categorySlug);
  const [l1, l2] = twoLines(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${color}"/>
    <stop offset="1" stop-color="${color}" stop-opacity="0.62"/>
  </linearGradient>
</defs>
<rect width="400" height="300" fill="url(#g)"/>
<g fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M200 96 L246 122 L246 174 L200 200 L154 174 L154 122 Z"/>
  <path d="M154 122 L200 148 L246 122"/>
  <path d="M200 148 L200 200"/>
</g>
<text x="200" y="244" text-anchor="middle" font-family="system-ui,Segoe UI,Arial" font-size="22" font-weight="700" fill="#ffffff">${esc(l1)}</text>
${l2 ? `<text x="200" y="270" text-anchor="middle" font-family="system-ui,Segoe UI,Arial" font-size="22" font-weight="700" fill="#ffffff">${esc(l2)}</text>` : ""}
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** URL da mostrare: foto reale se presente, altrimenti il segnaposto generato. */
export function productImage(p: { name: string; image_url?: string | null }, categorySlug?: string): string {
  const url = (p.image_url || "").trim();
  if (url && /^https?:\/\//i.test(url)) return url;
  return placeholderImage(p.name, categorySlug);
}
