// Stile applicativo: palette colori + struttura box. Applica variabili CSS su <html>,
// persiste la scelta e la riapplica al caricamento. Usato da Impostazioni (scelta) e AppShell (carica).

export type Pal = { name: string; vars: Record<string, string>; dark?: Record<string, string>; swatch: string[]; rails?: string };

export const VAR_KEYS = ["--paper", "--surface", "--wash", "--line", "--txt", "--dim", "--faint", "--focus"];

export const PALETTES: Pal[] = [
  { name: "Greige (predefinito)", swatch: ["#EEECE8", "#FAF9F7", "#2F6BB0"], vars: { "--paper": "#EEECE8", "--surface": "#FAF9F7", "--wash": "#E6E2DB", "--line": "#E1DDD6", "--txt": "#26241F", "--dim": "#726D64", "--faint": "#A69E90", "--focus": "#2F6BB0" }, dark: { "--paper": "#17150F", "--surface": "#221F18", "--wash": "#2B2820", "--line": "#37322A", "--txt": "#ECE8E0", "--dim": "#A69E90", "--faint": "#6F685C", "--focus": "#6FA3DC" } },
  { name: "Grigio caldo", swatch: ["#F6F6F7", "#FFFFFF", "#4F46E5"], vars: { "--paper": "#F6F6F7", "--surface": "#FFFFFF", "--wash": "#EFEFF1", "--line": "#E5E5E8", "--txt": "#1F2127", "--dim": "#5F6067", "--faint": "#9A9BA2", "--focus": "#4F46E5" }, dark: { "--paper": "#16161A", "--surface": "#1E1E24", "--wash": "#26262C", "--line": "#313138", "--txt": "#ECECEF", "--dim": "#9A9AA2", "--faint": "#6C6C74", "--focus": "#8B84F5" } },
  { name: "Sabbia", swatch: ["#F1ECE3", "#FBF9F4", "#A6763B"], vars: { "--paper": "#F1ECE3", "--surface": "#FBF9F4", "--wash": "#EFE7D8", "--line": "#E5DDCE", "--txt": "#2A2620", "--dim": "#7A7160", "--faint": "#B3A992", "--focus": "#A6763B" }, dark: { "--paper": "#1A1610", "--surface": "#241F17", "--wash": "#2E271C", "--line": "#3A3227", "--txt": "#EEE7DA", "--dim": "#B3A992", "--faint": "#7A7160", "--focus": "#C89B5E" } },
  { name: "Ardesia fredda", swatch: ["#EEF1F4", "#FFFFFF", "#3E6B8B"], vars: { "--paper": "#EEF1F4", "--surface": "#FFFFFF", "--wash": "#E6EBF1", "--line": "#DCE2E8", "--txt": "#1B222B", "--dim": "#64707E", "--faint": "#97A3B0", "--focus": "#3E6B8B" }, dark: { "--paper": "#12171C", "--surface": "#1B2127", "--wash": "#232B33", "--line": "#2E3740", "--txt": "#E7ECF1", "--dim": "#97A3B0", "--faint": "#64707E", "--focus": "#5E93BC" } },
  { name: "Grafite (rail scuri)", swatch: ["#F4F4F5", "#1F1F26", "#4F46E5"], vars: { "--paper": "#F4F4F5", "--surface": "#FFFFFF", "--wash": "#EFEFF1", "--line": "#E4E4E7", "--txt": "#18181B", "--dim": "#5F6067", "--faint": "#9A9BA2", "--focus": "#4F46E5" }, dark: { "--paper": "#131318", "--surface": "#1E1E24", "--wash": "#26262C", "--line": "#313138", "--txt": "#ECECEF", "--dim": "#9A9AA2", "--faint": "#6C6C74", "--focus": "#8B84F5" }, rails: "aside{--surface:#1F1F26;--wash:#2A2A33;--line:#2E2E38;--txt:#E9E9EE;--dim:#B4B4BE;--faint:#8A8A94}footer{--line:#2E2E38;--faint:#9A9AA4;--dim:#B4B4BE;background:#1F1F26}" },

  // ── Proposte aggiuntive (24/09/2026): 5 pensate per il chiaro + 5 per lo scuro.
  // Effetto "vetro": --surface quasi opaca (94-97%), --wash/--line in rgba per una
  // leggera trasparenza a più livelli (carta → sezione → riquadro).
  { name: "Vetro Acqua", swatch: ["#EAF6F6", "#FFFFFF", "#0D9CA8"], vars: { "--paper": "#EAF6F6", "--surface": "rgba(255,255,255,.94)", "--wash": "rgba(13,156,168,.10)", "--line": "rgba(13,156,168,.22)", "--txt": "#0B2A2C", "--dim": "#3E6F72", "--faint": "#86ADB0", "--focus": "#0D9CA8" }, dark: { "--paper": "#071619", "--surface": "rgba(255,255,255,.07)", "--wash": "rgba(255,255,255,.04)", "--line": "rgba(255,255,255,.12)", "--txt": "#E4F5F5", "--dim": "#9FC8CA", "--faint": "#5B8688", "--focus": "#4DD8DF" } },
  { name: "Vetro Lilla", swatch: ["#F1EEFC", "#FFFFFF", "#7C5CFC"], vars: { "--paper": "#F1EEFC", "--surface": "rgba(255,255,255,.94)", "--wash": "rgba(124,92,252,.10)", "--line": "rgba(124,92,252,.22)", "--txt": "#241B3D", "--dim": "#5C4E82", "--faint": "#A79BCB", "--focus": "#7C5CFC" }, dark: { "--paper": "#120E1F", "--surface": "rgba(255,255,255,.07)", "--wash": "rgba(255,255,255,.04)", "--line": "rgba(255,255,255,.12)", "--txt": "#EDE8FB", "--dim": "#B7ABDD", "--faint": "#6B5D91", "--focus": "#A78BFA" } },
  { name: "Vetro Corallo", swatch: ["#FCEEEA", "#FFFFFF", "#E85D4F"], vars: { "--paper": "#FCEEEA", "--surface": "rgba(255,255,255,.94)", "--wash": "rgba(232,93,79,.10)", "--line": "rgba(232,93,79,.22)", "--txt": "#3A1D18", "--dim": "#8A5148", "--faint": "#D4A199", "--focus": "#E85D4F" }, dark: { "--paper": "#1D100D", "--surface": "rgba(255,255,255,.07)", "--wash": "rgba(255,255,255,.04)", "--line": "rgba(255,255,255,.12)", "--txt": "#FBE9E5", "--dim": "#DCA79E", "--faint": "#8A5148", "--focus": "#FF8A75" } },
  { name: "Vetro Menta", swatch: ["#EAF8F0", "#FFFFFF", "#12B76A"], vars: { "--paper": "#EAF8F0", "--surface": "rgba(255,255,255,.94)", "--wash": "rgba(18,183,106,.10)", "--line": "rgba(18,183,106,.22)", "--txt": "#0E2A1C", "--dim": "#3E7256", "--faint": "#8FC4AA", "--focus": "#12B76A" }, dark: { "--paper": "#081712", "--surface": "rgba(255,255,255,.07)", "--wash": "rgba(255,255,255,.04)", "--line": "rgba(255,255,255,.12)", "--txt": "#E6F7EE", "--dim": "#9ECDB4", "--faint": "#568A6E", "--focus": "#3EE38C" } },
  { name: "Vetro Rosa", swatch: ["#FBEAF3", "#FFFFFF", "#D6409F"], vars: { "--paper": "#FBEAF3", "--surface": "rgba(255,255,255,.94)", "--wash": "rgba(214,64,159,.10)", "--line": "rgba(214,64,159,.22)", "--txt": "#33111F", "--dim": "#7E3F5F", "--faint": "#CE9CB8", "--focus": "#D6409F" }, dark: { "--paper": "#1B0E15", "--surface": "rgba(255,255,255,.07)", "--wash": "rgba(255,255,255,.04)", "--line": "rgba(255,255,255,.12)", "--txt": "#FBE8F1", "--dim": "#DDA2C1", "--faint": "#7E3F5F", "--focus": "#F472B6" } },

  { name: "Ossidiana Blu", swatch: ["#080B14", "#151C2E", "#4C8DFF"], vars: { "--paper": "#EEF2FC", "--surface": "rgba(255,255,255,.95)", "--wash": "rgba(76,141,255,.08)", "--line": "rgba(76,141,255,.18)", "--txt": "#101733", "--dim": "#4C5A85", "--faint": "#93A2C9", "--focus": "#3B6FE0" }, dark: { "--paper": "#080B14", "--surface": "rgba(255,255,255,.06)", "--wash": "rgba(255,255,255,.035)", "--line": "rgba(255,255,255,.11)", "--txt": "#E7EDFB", "--dim": "#9AA9CE", "--faint": "#5A6690", "--focus": "#4C8DFF" } },
  { name: "Grafite Profondo", swatch: ["#0E0E11", "#1A1A1F", "#9B93FF"], vars: { "--paper": "#F1F1F4", "--surface": "rgba(255,255,255,.95)", "--wash": "rgba(99,102,241,.08)", "--line": "rgba(99,102,241,.16)", "--txt": "#17171C", "--dim": "#54545F", "--faint": "#9A9AA6", "--focus": "#6C63FF" }, dark: { "--paper": "#0E0E11", "--surface": "rgba(255,255,255,.06)", "--wash": "rgba(255,255,255,.035)", "--line": "rgba(255,255,255,.11)", "--txt": "#EDEDF2", "--dim": "#A3A3AE", "--faint": "#66666F", "--focus": "#9B93FF" } },
  { name: "Notte Indaco", swatch: ["#0B0E22", "#161A3A", "#818CF8"], vars: { "--paper": "#EEEFFC", "--surface": "rgba(255,255,255,.95)", "--wash": "rgba(129,140,248,.09)", "--line": "rgba(129,140,248,.20)", "--txt": "#141534", "--dim": "#4B4E85", "--faint": "#9598C9", "--focus": "#5B5FE0" }, dark: { "--paper": "#0B0E22", "--surface": "rgba(255,255,255,.06)", "--wash": "rgba(255,255,255,.035)", "--line": "rgba(255,255,255,.11)", "--txt": "#E9EAFB", "--dim": "#A2A6D9", "--faint": "#5D6199", "--focus": "#818CF8" } },
  { name: "Carbone Caldo", swatch: ["#15120F", "#211C17", "#F0A857"], vars: { "--paper": "#F5F1EA", "--surface": "rgba(255,255,255,.95)", "--wash": "rgba(240,168,87,.10)", "--line": "rgba(240,168,87,.22)", "--txt": "#241E15", "--dim": "#6E5F4C", "--faint": "#B7A88F", "--focus": "#C97F2E" }, dark: { "--paper": "#15120F", "--surface": "rgba(255,255,255,.06)", "--wash": "rgba(255,255,255,.035)", "--line": "rgba(255,255,255,.11)", "--txt": "#F2ECE3", "--dim": "#B8AFA1", "--faint": "#6E655A", "--focus": "#F0A857" } },
  { name: "Blu Abisso", swatch: ["#050E14", "#0E1E27", "#22D3EE"], vars: { "--paper": "#E9F6FA", "--surface": "rgba(255,255,255,.95)", "--wash": "rgba(34,211,238,.08)", "--line": "rgba(34,211,238,.18)", "--txt": "#08222B", "--dim": "#3A6E7C", "--faint": "#8FBFCB", "--focus": "#0EA5C4" }, dark: { "--paper": "#050E14", "--surface": "rgba(255,255,255,.06)", "--wash": "rgba(255,255,255,.035)", "--line": "rgba(255,255,255,.11)", "--txt": "#E3F7FB", "--dim": "#8FC2D1", "--faint": "#4C7684", "--focus": "#22D3EE" } },
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
  // Pulisce eventuali variabili inline legacy (versioni precedenti scrivevano su <html>).
  VAR_KEYS.forEach((k) => document.documentElement.style.removeProperty(k));
  if (i === null || !PALETTES[i] || i === 0) {
    setStyleTag("xen-pal", "");
    setStyleTag("xen-rails", "");
    try { i === 0 ? localStorage.setItem(P_KEY, "0") : localStorage.removeItem(P_KEY); } catch {}
    return;
  }
  const p = PALETTES[i];
  // Palette theme-aware via <style>: :root per il chiaro, .dark per lo scuro
  // (la classe .dark è su un contenitore, quindi vince sulle variabili di :root).
  const light = VAR_KEYS.map((k) => `${k}:${p.vars[k]}`).join(";");
  const darkVars = p.dark ?? p.vars;
  const dark = VAR_KEYS.map((k) => (darkVars[k] ? `${k}:${darkVars[k]}` : "")).filter(Boolean).join(";");
  setStyleTag("xen-pal", `:root{${light}}` + (dark ? ` .dark{${dark}}` : ""));
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
