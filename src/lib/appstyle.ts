// Stile applicativo: palette colori + struttura box. Applica variabili CSS su <html>,
// persiste la scelta e la riapplica al caricamento. Usato da Impostazioni (scelta) e AppShell (carica).

export type Pal = { name: string; vars: Record<string, string>; swatch: string[]; rails?: string };

export const VAR_KEYS = ["--paper", "--surface", "--wash", "--line", "--txt", "--dim", "--faint", "--focus"];

export const PALETTES: Pal[] = [
  { name: "Greige (predefinito)", swatch: ["#EEECE8", "#FAF9F7", "#2F6BB0"], vars: { "--paper": "#EEECE8", "--surface": "#FAF9F7", "--wash": "#E6E2DB", "--line": "#E1DDD6", "--txt": "#26241F", "--dim": "#726D64", "--faint": "#A69E90", "--focus": "#2F6BB0" } },
  { name: "Grigio caldo", swatch: ["#F6F6F7", "#FFFFFF", "#4F46E5"], vars: { "--paper": "#F6F6F7", "--surface": "#FFFFFF", "--wash": "#EFEFF1", "--line": "#E5E5E8", "--txt": "#1F2127", "--dim": "#5F6067", "--faint": "#9A9BA2", "--focus": "#4F46E5" } },
  { name: "Sabbia", swatch: ["#F1ECE3", "#FBF9F4", "#A6763B"], vars: { "--paper": "#F1ECE3", "--surface": "#FBF9F4", "--wash": "#EFE7D8", "--line": "#E5DDCE", "--txt": "#2A2620", "--dim": "#7A7160", "--faint": "#B3A992", "--focus": "#A6763B" } },
  { name: "Ardesia fredda", swatch: ["#EEF1F4", "#FFFFFF", "#3E6B8B"], vars: { "--paper": "#EEF1F4", "--surface": "#FFFFFF", "--wash": "#E6EBF1", "--line": "#DCE2E8", "--txt": "#1B222B", "--dim": "#64707E", "--faint": "#97A3B0", "--focus": "#3E6B8B" } },
  { name: "Grafite (rail scuri)", swatch: ["#F4F4F5", "#1F1F26", "#4F46E5"], vars: { "--paper": "#F4F4F5", "--surface": "#FFFFFF", "--wash": "#EFEFF1", "--line": "#E4E4E7", "--txt": "#18181B", "--dim": "#5F6067", "--faint": "#9A9BA2", "--focus": "#4F46E5" }, rails: "aside{--surface:#1F1F26;--wash:#2A2A33;--line:#2E2E38;--txt:#E9E9EE;--dim:#B4B4BE;--faint:#8A8A94}footer{--line:#2E2E38;--faint:#9A9AA4;--dim:#B4B4BE;background:#1F1F26}" },
];

export type Struct = { name: string; css: string };
export const STRUCTS: Struct[] = [
  { name: "Arrotondata (predefinito)", css: "" },
  { name: "Squadrata hairline", css: ".rounded-xl,.rounded-2xl,.rounded-lg{border-radius:2px!important}.shadow-sm,.shadow-md,.shadow{box-shadow:none!important}" },
  { name: "Morbida senza bordo", css: ".rounded-xl,.rounded-2xl,.rounded-lg{border-radius:10px!important}.border.border-line{border-color:transparent!important}.shadow-sm{box-shadow:0 2px 12px rgba(20,20,40,.08)!important}" },
  { name: "Accento a sinistra", css: ".rounded-xl{border-radius:3px!important;border-left:3px solid var(--focus)!important}.shadow-sm{box-shadow:none!important}" },
  { name: "Testata a colore", css: ".rounded-xl{border-radius:6px!important;border-top:3px solid var(--focus)!important}.shadow-sm{box-shadow:none!important}" },
];

const P_KEY = "spigolestay:style:palette";
const S_KEY = "spigolestay:style:struct";

function setStyleTag(id: string, css: string) {
  if (typeof document === "undefined") return;
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) { el?.remove(); return; }
  if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
  el.textContent = css;
}

export function applyPalette(i: number | null) {
  if (typeof document === "undefined") return;
  if (i === null || !PALETTES[i] || i === 0) {
    VAR_KEYS.forEach((k) => document.documentElement.style.removeProperty(k));
    setStyleTag("xen-rails", "");
    try { i === 0 ? localStorage.setItem(P_KEY, "0") : localStorage.removeItem(P_KEY); } catch {}
    return;
  }
  const p = PALETTES[i];
  VAR_KEYS.forEach((k) => document.documentElement.style.setProperty(k, p.vars[k]));
  setStyleTag("xen-rails", p.rails ?? "");
  try { localStorage.setItem(P_KEY, String(i)); } catch {}
}

export function applyStruct(i: number | null) {
  if (typeof document === "undefined") return;
  if (i === null || !STRUCTS[i] || i === 0) {
    setStyleTag("xen-box", "");
    try { i === 0 ? localStorage.setItem(S_KEY, "0") : localStorage.removeItem(S_KEY); } catch {}
    return;
  }
  setStyleTag("xen-box", STRUCTS[i].css);
  try { localStorage.setItem(S_KEY, String(i)); } catch {}
}

export function getSavedStyle(): { pal: number; str: number } {
  let pal = 0, str = 0;
  try { const a = localStorage.getItem(P_KEY); if (a !== null) pal = Number(a); const b = localStorage.getItem(S_KEY); if (b !== null) str = Number(b); } catch {}
  return { pal, str };
}

export function loadAndApplyStyle() {
  const { pal, str } = getSavedStyle();
  if (pal) applyPalette(pal);
  if (str) applyStruct(str);
}
