import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Contrasti dei token di globals.css (WCAG 2.1: testo >= 4,5:1) e «argine» contro nuovi modali scritti a mano.
const css = fs.readFileSync(path.join(import.meta.dirname, "../src/app/globals.css"), "utf8");

function block(re: RegExp): string {
  const m = re.exec(css);
  assert.ok(m, "blocco non trovato: " + re);
  return m![1];
}
const LIGHT = block(/:root \{\s*color-scheme: light;([\s\S]*?)\n\}/);
const DARK = block(/\.dark \{\s*color-scheme: dark;([\s\S]*?)\n\}/);
const tok = (b: string, name: string): string => {
  const m = new RegExp("--" + name + ":\\s*(#[0-9A-Fa-f]{6})").exec(b);
  assert.ok(m, "token mancante: --" + name);
  return m![1];
};
const lum = (hex: string) => {
  const lin = (i: number) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
};
const cr = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (c: string, bg: string, p: number) => {
  const h = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const a = h(c), b = h(bg);
  return "#" + a.map((v, i) => Math.round(v * p + b[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
};

test("token WhatsApp: testo su verde >= 4,5:1 in chiaro e in scuro", () => {
  assert.ok(cr(tok(LIGHT, "on-wa"), tok(LIGHT, "wa")) >= 4.5, "chiaro");
  assert.ok(cr(tok(DARK, "on-wa"), tok(DARK, "wa")) >= 4.5, "scuro");
});

test("token Riassetto (--cl-rest): leggibile come testo su surface/paper/wash e sulla propria tinta 14 %", () => {
  for (const [name, B] of [["chiaro", LIGHT], ["scuro", DARK]] as const) {
    const c = tok(B, "cl-rest");
    for (const bg of ["surface", "paper", "wash"]) {
      const bgc = tok(B, bg);
      assert.ok(cr(c, bgc) >= 4.5, `${name}: testo su ${bg}`);
      assert.ok(cr(c, mix(c, bgc, 0.14)) >= 4.5, `${name}: su tinta/${bg}`);
    }
  }
});

test("coppie pieno + testo (focus/ok/warn/err) >= 4,5:1 in chiaro e in scuro", () => {
  for (const [name, B] of [["chiaro", LIGHT], ["scuro", DARK]] as const) {
    for (const k of ["focus", "ok", "warn", "err"]) {
      assert.ok(cr(tok(B, "on-" + k), tok(B, k)) >= 4.5, `${name}: on-${k} su ${k}`);
    }
  }
});

// ── Argine: niente nuovi overlay `fixed inset-0` scritti a mano (usare <Modal>). Elenco = quelli ancora ammessi (sheet/palette/pagine a tutto schermo
//    con comportamento proprio) e il massimo di occorrenze per file; se ne togli uno, abbassa il numero.
const ALLOWED: Record<string, number> = {
  "components/CalendarGrid.tsx": 9,        // calendario approvato dal titolare: non si ritocca
  "components/BookingDrawer.tsx": 2,       // pannello laterale della prenotazione
  "components/NewBookingModal.tsx": 1,     // flusso «nuova prenotazione» del calendario
  "components/Sidebar.tsx": 1,             // velo del menu su telefono
  "components/AssistantBar.tsx": 1,        // palette di ricerca/assistente
  "components/GlobalSearch.tsx": 1,        // palette di ricerca
  "components/OnboardingWizard.tsx": 1,    // percorso iniziale a schermata intera
  "components/Watermark.tsx": 1,           // filigrana non interattiva
  "components/ui/Modal.tsx": 2,            // il componente stesso
  "app/(app)/nettare/page.tsx": 1,         // pannello laterale
  "app/(app)/abbonamento/page.tsx": 1,     // finestra «Su misura» con pannello promozionale
  "app/(app)/canali/page.tsx": 1,          // finestra con iframe del collegamento canali
  "app/sito-web/page.tsx": 2,              // pagina pubblica (lightbox, privacy)
};

function walk(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

test("nessun nuovo overlay `fixed inset-0` scritto a mano fuori dall'elenco ammesso (usa <Modal>)", () => {
  const root = path.join(import.meta.dirname, "../src");
  const bad: string[] = [];
  for (const f of walk(root)) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    const src = fs.readFileSync(f, "utf8");
    if (src.includes("\u0000")) continue; // guida-ospiti (agente D): contiene byte NUL, non toccata qui
    const n = (src.match(/fixed inset-0/g) || []).length;
    const max = ALLOWED[rel] ?? 0;
    if (n > max) bad.push(`${rel}: ${n} > ${max}`);
  }
  assert.deepEqual(bad, [], "overlay a mano: migrare a <Modal> da @/components/ui");
});
