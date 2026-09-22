"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { nights, toISO, shiftISO } from "@/lib/dates";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { useConfirm } from "@/components/ConfirmProvider";
import { supabase } from "@/lib/supabase";
import { slugify } from "@/lib/publicdata";

const ACCENTS = ["#4F46E5", "#0E7C66", "#B4531F", "#B3453A", "#0891B2", "#DB2777"];
const FONTS: [string, string][] = [
  ["system", "Predefinito (sistema)"], ["Verdana, sans-serif", "Verdana"], ["Georgia, serif", "Georgia"],
  ["Arial, sans-serif", "Arial"], ["'Times New Roman', serif", "Times New Roman"], ["Tahoma, sans-serif", "Tahoma"],
  ["'Trebuchet MS', sans-serif", "Trebuchet MS"], ["'Courier New', monospace", "Courier"],
];
type Layout = "form" | "inline" | "horizontal";
const LAYOUTS: { key: Layout; label: string; w: number; h: number; orient: "v" | "h" }[] = [
  { key: "form", label: "Form (verticale)", w: 440, h: 560, orient: "v" },
  { key: "horizontal", label: "Orizzontale", w: 760, h: 250, orient: "h" },
  { key: "inline", label: "Inline (barra)", w: 980, h: 120, orient: "h" },
];

interface Cfg {
  id: string; name: string; structureId: string;
  showHeader: boolean; theme: "rounded" | "square"; accent: string; lang: string;
  layout: Layout; font: string; customCss: string;
  askChildren: boolean; showPrices: boolean;
  leadDays: number; stayLen: number; defGuests: number;
  checkInFrom: string; checkOutBy: string; showUnavailable: boolean; requirePhone: boolean; minStay: number;
  payCard: boolean; payPaypal: boolean; payTransfer: boolean; payOnsite: boolean;
  deposit: "none" | "firstNight" | "percent"; depositPct: number;
  adjMode: "none" | "fixed" | "percent"; adjValue: number;
  embedMinHeight: number; embedInheritAccent: boolean;
}
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));
const makeCfg = (structureId: string, name: string): Cfg => ({
  id: newId(), name, structureId,
  showHeader: true, theme: "rounded", accent: ACCENTS[0], lang: "it",
  layout: "form", font: "system", customCss: "",
  askChildren: false, showPrices: true,
  leadDays: 0, stayLen: 2, defGuests: 2,
  checkInFrom: "15:00", checkOutBy: "10:00", showUnavailable: false, requirePhone: true, minStay: 1,
  payCard: true, payPaypal: true, payTransfer: true, payOnsite: false,
  deposit: "percent", depositPct: 30,
  adjMode: "none", adjValue: 0,
  embedMinHeight: 640, embedInheritAccent: true,
});
const THEME_LABEL = (th: string) => (th === "rounded" ? "Arrotondato" : "Squadrato");
const LAYOUT_LABEL = (l: Layout) => LAYOUTS.find((x) => x.key === l)?.label ?? l;

const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-focus" : "bg-[color:var(--line)]"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
function Rowt({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div><div className="text-sm text-txt">{label}</div>{hint && <div className="text-[11px] text-faint">{hint}</div>}</div>
      {children}
    </div>
  );
}

const WKEY = "spigolestay:widgets:v1";

export default function WidgetPage() {
  const { t } = useLang();
  const ask = useConfirm();
  const { structures, roomTypes, activeStructureId } = useData();

  const [widgets, setWidgets] = useState<Cfg[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Carica i widget salvati; migra l'eventuale vecchia configurazione singola.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WKEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) setWidgets(arr); }
      else {
        const old = localStorage.getItem("spigolestay:widget");
        if (old) { const o = JSON.parse(old); const m = { ...makeCfg(structures[0]?.id ?? "", o.name || (structures[0]?.name ?? "Widget")), ...o, id: newId() }; setWidgets([m]); }
      }
    } catch {}
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (loaded) try { localStorage.setItem(WKEY, JSON.stringify(widgets)); } catch {} }, [widgets, loaded]);

  const c = widgets.find((w) => w.id === editingId) ?? null;
  const set = <K extends keyof Cfg>(k: K, v: Cfg[K]) => { if (!c) return; setWidgets((prev) => prev.map((w) => (w.id === c.id ? { ...w, [k]: v } : w))); };

  // Lista filtrata per la struttura selezionata in alto ("Tutte" = tutti i widget).
  const shownWidgets = activeStructureId === "all" ? widgets : widgets.filter((w) => w.structureId === activeStructureId);
  const defStructId = activeStructureId !== "all" && structures.some((s) => s.id === activeStructureId) ? activeStructureId : (structures[0]?.id ?? "");
  const defStructName = structures.find((s) => s.id === defStructId)?.name ?? "Widget";
  const createWidget = () => { const w = makeCfg(defStructId, `${defStructName} ${widgets.length + 1}`); setWidgets((p) => [...p, w]); setEditingId(w.id); };
  const deleteWidget = (id: string) => setWidgets((p) => p.filter((w) => w.id !== id));

  // ── stato anteprima interattiva ──
  const structureId = c?.structureId ?? structures[0]?.id ?? "";
  const typesOf = roomTypes.filter((rt) => rt.structureId === structureId);
  const [ci, setCi] = useState(toISO(new Date()));
  const [co, setCo] = useState(shiftISO(toISO(new Date()), 2));
  const [guests, setGuests] = useState(2);
  const [children, setChildren] = useState(0);
  const [rtId, setRtId] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [doneMsg, setDoneMsg] = useState(false);
  const [copied, setCopied] = useState("");
  useEffect(() => { if (typesOf.length && !typesOf.some((x) => x.id === rtId)) setRtId(typesOf[0].id); }, [typesOf, rtId]);

  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  useEffect(() => {
    const el = previewWrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setAvailW(el.clientWidth));
    ro.observe(el); setAvailW(el.clientWidth);
    return () => ro.disconnect();
  }, [editingId]);

  // Slug pubblicato della struttura (per lo snippet embed reale). Se la struttura
  // non è ancora pubblicata su Xenosite, lo slug resta null e mostriamo l'avviso.
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [slugChecked, setSlugChecked] = useState(false);
  useEffect(() => {
    setPublishedSlug(null); setSlugChecked(false);
    if (!structureId || !supabase) { setSlugChecked(true); return; }
    let alive = true;
    supabase.from("public_sites").select("slug").eq("structure_id", structureId).maybeSingle()
      .then(({ data }) => { if (alive) { setPublishedSlug((data?.slug as string) ?? null); setSlugChecked(true); } });
    return () => { alive = false; };
  }, [structureId]);

  const structure = structures.find((s) => s.id === structureId);
  const rt = roomTypes.find((r) => r.id === rtId);
  const n = Math.max(1, nights(ci, co));
  const fontFamily = useMemo(() => (c && c.font !== "system" ? c.font : undefined), [c]);

  if (!loaded) return <div><PageHeader title={t("Widget sito")} subtitle="" /></div>;

  // ═══════════ LISTA WIDGET ═══════════
  if (!c) {
    return (
      <div>
        <PageHeader title={t("Widget sito")} subtitle={t("Crea uno o più widget di prenotazione per il tuo sito")}
          actions={<button onClick={createWidget} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">+ {t("Crea un nuovo widget")}</button>} />
        <Card>
          {shownWidgets.length === 0 ? (
            <div className="py-10 text-center text-sm text-faint">{t("Nessun widget per questa struttura. Creane uno con “+ Crea un nuovo widget”.")}</div>
          ) : (
            <>
              {/* Telefono: lista a schede (tap affidabile; niente tabella larga da scorrere) */}
              <div className="flex flex-col gap-2 md:hidden">
                {shownWidgets.map((w) => (
                  <button key={w.id} onClick={() => setEditingId(w.id)} className="block w-full rounded-xl border border-line bg-surface p-3 text-left shadow-sm active:bg-wash">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-txt">{w.name || "—"}</span>
                      <span className="shrink-0 text-faint">›</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
                      <span>{structures.find((s) => s.id === w.structureId)?.name ?? "—"}</span>
                      <span className="text-faint">·</span>
                      <span>{t(THEME_LABEL(w.theme))}</span>
                      <span className="text-faint">·</span>
                      <span>{t(LAYOUT_LABEL(w.layout))}</span>
                      <span className="text-faint">·</span>
                      <span className="inline-flex items-center gap-1"><span className="h-3.5 w-3.5 shrink-0 rounded-full border border-line" style={{ backgroundColor: w.accent }} /><span className="uppercase">{w.lang}</span></span>
                    </div>
                  </button>
                ))}
              </div>
              {/* Tabella (tablet/desktop) */}
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[680px] text-sm">
                <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-semibold">{t("Nome")}</th><th className="py-2 pr-3 font-semibold">{t("Struttura")}</th><th className="py-2 pr-3 font-semibold">{t("Tema")}</th><th className="py-2 pr-3 font-semibold">Layout</th><th className="py-2 pr-3 font-semibold">{t("Colore")}</th><th className="py-2 pr-3 font-semibold">Font</th><th className="py-2 pr-3 font-semibold">{t("Lingua")}</th><th className="py-2 text-right font-semibold"></th>
                </tr></thead>
                <tbody>
                  {shownWidgets.map((w) => (
                    <tr key={w.id} onClick={() => setEditingId(w.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                      <td className="py-2.5 pr-3 font-medium text-txt">{w.name || "—"}</td>
                      <td className="py-2.5 pr-3 text-dim">{structures.find((s) => s.id === w.structureId)?.name ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-dim">{t(THEME_LABEL(w.theme))}</td>
                      <td className="py-2.5 pr-3 text-dim">{t(LAYOUT_LABEL(w.layout))}</td>
                      <td className="py-2.5 pr-3"><span className="inline-flex items-center gap-1.5 text-dim"><span className="h-4 w-4 shrink-0 rounded-full border border-line" style={{ backgroundColor: w.accent }} /><span className="font-mono text-xs">{w.accent}</span></span></td>
                      <td className="py-2.5 pr-3 text-dim">{w.font === "system" ? t("Sistema") : w.font.replace(/['"]/g, "").split(",")[0]}</td>
                      <td className="py-2.5 pr-3 text-dim uppercase">{w.lang}</td>
                      <td className="py-2.5 text-right text-faint">›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  // ═══════════ EDITOR ═══════════
  const raw = (rt?.basePrice ?? 100) * n;
  const price = c.adjMode === "fixed" ? Math.max(0, raw + c.adjValue) : c.adjMode === "percent" ? Math.max(0, Math.round(raw * (1 + c.adjValue / 100))) : raw;
  const depositAmt = c.deposit === "firstNight" ? (rt?.basePrice ?? 100) : c.deposit === "percent" ? Math.round(price * c.depositPct / 100) : 0;

  // Anteprima: SIMULA la prenotazione (mostra la conferma) SENZA creare dati reali.
  const prenota = () => {
    if (!lastName.trim() && !firstName.trim()) return;
    setDoneMsg(true);
    window.setTimeout(() => { setDoneMsg(false); setLastName(""); setFirstName(""); setEmail(""); setPhone(""); }, 3500);
  };

  const sitekey = `${structureId}-${c.accent.replace("#", "")}`;
  const cssBlock = (c.font !== "system" || c.customCss.trim())
    ? `<style>\n#spigole-book{${c.font !== "system" ? `font-family:${c.font};` : ""}}\n${c.customCss.trim()}\n</style>\n`
    : "";
  const script = `${cssBlock}<div id="spigole-book" data-sitekey="${sitekey}" data-layout="${c.layout}"></div>\n<script type="text/javascript" src="https://book.xenora.com/widget/js/form.js" data-sitekey="${sitekey}" async></script>`;
  const lay = LAYOUTS.find((l) => l.key === c.layout) ?? LAYOUTS[0];
  const iframe = `${cssBlock}<iframe src="https://book.xenora.com/w/${sitekey}?lang=${c.lang}&layout=${c.layout}&font=${encodeURIComponent(c.font)}" width="${lay.w}" height="${lay.h}" style="border:0;width:100%;max-width:${lay.w}px" title="Prenota — ${structure?.name ?? ""}"></iframe>`;
  const copy = (k: string, txt: string) => { navigator.clipboard?.writeText(txt); setCopied(k); window.setTimeout(() => setCopied(""), 1500); };
  const radius = c.theme === "rounded" ? 16 : 4;
  const previewScale = availW ? Math.min(1, availW / lay.w) : 1;

  // ── Snippet EMBED reale (motore /prenota → route pubblica /embed/<slug>) ──
  const PUBLIC_HOST = "xenora.it";
  const publicBase = `https://${PUBLIC_HOST}`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const minH = c.embedMinHeight ?? 640;
  const inheritAccent = c.embedInheritAccent ?? true;
  // Slug reale se pubblicato; altrimenti l'anteprima dello slug per far vedere la forma dello snippet.
  const embedSlug = publishedSlug || slugify(structure?.name || "") || "la-tua-struttura";
  const embedUrl = `${publicBase}/embed/${embedSlug}`;
  const iframeEmbed = `<iframe src="${embedUrl}" style="width:100%;border:0;min-height:${minH}px" title="Prenota — ${structure?.name ?? ""}"></iframe>`;
  const scriptEmbed = `<script src="${publicBase}/embed.js" data-site="${embedSlug}"${minH !== 640 ? ` data-min-height="${minH}"` : ""}${!inheritAccent ? ` data-accent="${c.accent}"` : ""}></script>`;
  // Anteprima dal vivo: usa il motore in modalità embed con i dati locali del proprietario
  // (nessuna pubblicazione necessaria per vedere l'anteprima).
  const embedPreviewSrc = `${origin}/prenota?embed=1&s=${encodeURIComponent(structureId)}${!inheritAccent ? `&accent=${encodeURIComponent(c.accent)}` : ""}`;

  return (
    <div>
      <PageHeader title={c.name || t("Widget")} subtitle={t("Configura il widget; le prenotazioni entrano dirette nel calendario")}
        actions={<div className="flex items-center gap-2"><button onClick={() => setEditingId(null)} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">← {t("Torna alla lista")}</button><button onClick={async () => { if (c && await ask({ title: t("Elimina widget"), message: `${t("Eliminare")} "${c.name || t("Widget")}"?`, danger: true, confirmLabel: t("Elimina") })) { deleteWidget(c.id); setEditingId(null); } }} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button><button onClick={() => setEditingId(null)} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Salva")}</button></div>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("Aspetto")}</SectionTitle>
            <label className="block text-xs font-medium text-dim">{t("Nome")}
              <input value={c.name} onChange={(e) => set("name", e.target.value)} className={`mt-1 ${inp}`} placeholder={t("Es. Widget sito ufficiale")} />
            </label>
            <label className="mt-2 block text-xs font-medium text-dim">{t("Struttura")}
              <select value={structureId} onChange={(e) => set("structureId", e.target.value)} className={`mt-1 ${inp}`}>
                {structures.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">Layout <span className="font-normal text-faint">{t("(forma)")}</span>
                <select value={c.layout} onChange={(e) => set("layout", e.target.value as Layout)} className={`mt-1 ${inp}`}>{LAYOUTS.map((l) => (<option key={l.key} value={l.key}>{t(l.label)}</option>))}</select>
              </label>
              <label className="block text-xs font-medium text-dim">{t("Font")}
                <select value={c.font} onChange={(e) => set("font", e.target.value)} className={`mt-1 ${inp}`}>{FONTS.map(([v, n2]) => (<option key={v} value={v}>{n2}</option>))}</select>
              </label>
              <label className="block text-xs font-medium text-dim">{t("Tema")}
                <select value={c.theme} onChange={(e) => set("theme", e.target.value as Cfg["theme"])} className={`mt-1 ${inp}`}><option value="rounded">{t("Arrotondato")}</option><option value="square">{t("Squadrato")}</option></select>
              </label>
              <label className="block text-xs font-medium text-dim">{t("Lingua")}
                <select value={c.lang} onChange={(e) => set("lang", e.target.value)} className={`mt-1 ${inp}`}><option value="it">Italiano</option><option value="en">English</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="es">Español</option></select>
              </label>
            </div>
            <div className="mt-2">
              <div className="mb-1 text-xs font-medium text-dim">{t("Colore")}</div>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((col) => (<button key={col} onClick={() => set("accent", col)} className="h-7 w-7 rounded-full transition" style={{ backgroundColor: col, outline: c.accent === col ? "2px solid var(--txt)" : "none", outlineOffset: 2 }} />))}
              </div>
            </div>
            <div className="mt-2 divide-y divide-[color:var(--line)]">
              <Rowt label={t("Mostra intestazione")}><Toggle on={c.showHeader} onChange={(v) => set("showHeader", v)} /></Rowt>
              <Rowt label={t("Mostra i prezzi")}><Toggle on={c.showPrices} onChange={(v) => set("showPrices", v)} /></Rowt>
              <Rowt label={t("Chiedi il numero di bambini")}><Toggle on={c.askChildren} onChange={(v) => set("askChildren", v)} /></Rowt>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Valori predefiniti")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-dim">{t("Anticipo (gg)")}<input type="number" min={0} value={c.leadDays} onChange={(e) => set("leadDays", +e.target.value)} className={`mt-1 ${inp}`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Durata (notti)")}<input type="number" min={1} value={c.stayLen} onChange={(e) => set("stayLen", Math.max(1, +e.target.value))} className={`mt-1 ${inp}`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Ospiti")}<input type="number" min={1} value={c.defGuests} onChange={(e) => set("defGuests", Math.max(1, +e.target.value))} className={`mt-1 ${inp}`} /></label>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Regole prenotazione")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Check-in dalle")}<input value={c.checkInFrom} onChange={(e) => set("checkInFrom", e.target.value)} className={`mt-1 ${inp}`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Check-out entro")}<input value={c.checkOutBy} onChange={(e) => set("checkOutBy", e.target.value)} className={`mt-1 ${inp}`} /></label>
              <label className="block text-xs font-medium text-dim">{t("Soggiorno minimo (notti)")}<input type="number" min={1} value={c.minStay} onChange={(e) => set("minStay", Math.max(1, +e.target.value))} className={`mt-1 ${inp}`} /></label>
            </div>
            <div className="mt-2 divide-y divide-[color:var(--line)]">
              <Rowt label={t("Mostra anche le camere non disponibili")}><Toggle on={c.showUnavailable} onChange={(v) => set("showUnavailable", v)} /></Rowt>
              <Rowt label={t("Richiedi il numero di telefono")}><Toggle on={c.requirePhone} onChange={(v) => set("requirePhone", v)} /></Rowt>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Pagamenti accettati")}</SectionTitle>
            <div className="divide-y divide-[color:var(--line)]">
              <Rowt label={t("Carta di credito")} hint="VISA · Mastercard · American Express"><Toggle on={c.payCard} onChange={(v) => set("payCard", v)} /></Rowt>
              <Rowt label="PayPal"><Toggle on={c.payPaypal} onChange={(v) => set("payPaypal", v)} /></Rowt>
              <Rowt label={t("Bonifico bancario")}><Toggle on={c.payTransfer} onChange={(v) => set("payTransfer", v)} /></Rowt>
              <Rowt label={t("Pagamento sul posto")} hint={t("Nessuna carta a garanzia")}><Toggle on={c.payOnsite} onChange={(v) => set("payOnsite", v)} /></Rowt>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Acconto")}
                <select value={c.deposit} onChange={(e) => set("deposit", e.target.value as Cfg["deposit"])} className={`mt-1 ${inp}`}><option value="none">{t("Nessuno")}</option><option value="firstNight">{t("Prima notte")}</option><option value="percent">{t("Percentuale")}</option></select>
              </label>
              {c.deposit === "percent" && <label className="block text-xs font-medium text-dim">%<input type="number" min={0} max={100} value={c.depositPct} onChange={(e) => set("depositPct", +e.target.value)} className={`mt-1 ${inp}`} /></label>}
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Correzione prezzo")}</SectionTitle>
            <div className="flex items-center rounded-lg border border-line p-0.5">
              {(["none", "fixed", "percent"] as const).map((m) => (<button key={m} onClick={() => set("adjMode", m)} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${c.adjMode === m ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{m === "none" ? t("Nessuna") : m === "fixed" ? t("Valore fisso") : t("Percentuale")}</button>))}
            </div>
            {c.adjMode !== "none" && <label className="mt-2 block text-xs font-medium text-dim">{c.adjMode === "fixed" ? t("Variazione €") : t("Variazione %")} {t("(negativo per ridurre)")}<input type="number" value={c.adjValue} onChange={(e) => set("adjValue", +e.target.value)} className={`mt-1 ${inp}`} /></label>}
          </Card>

          <Card>
            <SectionTitle>{t("Codice sorgente")}</SectionTitle>
            <p className="mb-2 text-xs text-dim">{t("Copia e incolla nel tuo sito, dentro il tag")} <code>&lt;body&gt;</code>.</p>
            <div className="text-xs font-medium text-dim">Script</div>
            <div className="mt-1 flex items-start gap-2">
              <textarea readOnly value={script} rows={4} className="w-full resize-none rounded-lg border border-line bg-paper p-2 font-mono text-[11px] text-txt" />
              <button onClick={() => copy("s", script)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-txt hover:bg-wash">{copied === "s" ? "✓" : t("Copia")}</button>
            </div>
            <div className="mt-3 text-xs font-medium text-dim">Iframe</div>
            <div className="mt-1 flex items-start gap-2">
              <textarea readOnly value={iframe} rows={4} className="w-full resize-none rounded-lg border border-line bg-paper p-2 font-mono text-[11px] text-txt" />
              <button onClick={() => copy("i", iframe)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-txt hover:bg-wash">{copied === "i" ? "✓" : t("Copia")}</button>
            </div>
            <p className="mt-2 text-xs text-faint">{t("C'è anche il")} <b className="text-dim">{t("plugin WordPress")}</b> {t("(in arrivo): installalo e incolla la sitekey.")}</p>
          </Card>

          <Card>
            <SectionTitle>{t("Incorpora sul tuo sito")}</SectionTitle>
            <p className="mb-3 text-xs text-dim">{t("Mostra il motore di prenotazione di")} <b className="text-txt">{structure?.name ?? t("la tua struttura")}</b> {t("dentro il tuo sito esterno. Le prenotazioni arrivano dirette nel gestionale.")}</p>

            {/* Stato pubblicazione */}
            {slugChecked && (publishedSlug ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-wash px-3 py-2 text-xs">
                <span className="rounded-full px-2 py-0.5 font-semibold text-white" style={{ backgroundColor: "var(--ok)" }}>{t("Online")}</span>
                <span className="text-dim">{PUBLIC_HOST}/embed/</span><span className="font-mono font-semibold text-txt">{publishedSlug}</span>
              </div>
            ) : (
              <div className="mb-3 rounded-lg border border-line bg-wash px-3 py-2 text-xs text-dim">
                {t("Questa struttura non è ancora pubblicata.")} <a href="/sito" className="font-semibold text-focus hover:underline">{t("Pubblica il tuo Xenosite")}</a> {t("per attivare l'indirizzo dello snippet.")}
              </div>
            ))}

            {/* Opzioni */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">{t("Altezza minima (px)")}
                <input type="number" min={200} step={20} value={minH} onChange={(e) => set("embedMinHeight", Math.max(200, +e.target.value || 640))} className={`mt-1 ${inp}`} />
              </label>
              <div className="block text-xs font-medium text-dim">{t("Colore accento")}
                <div className="mt-1 flex items-center gap-2">
                  <span className="h-9 w-9 shrink-0 rounded-lg border border-line" style={{ backgroundColor: inheritAccent ? (structure?.photoColor ?? c.accent) : c.accent }} />
                  <label className="flex items-center gap-1.5 text-[11px] font-normal text-dim"><Toggle on={inheritAccent} onChange={(v) => set("embedInheritAccent", v)} /> {t("Eredita dalla struttura")}</label>
                </div>
              </div>
            </div>

            {/* Snippet A: iframe */}
            <div className="mt-3 text-xs font-medium text-dim">{t("1. Iframe semplice")}</div>
            <div className="mt-1 flex items-start gap-2">
              <textarea readOnly value={iframeEmbed} rows={2} className="w-full resize-none rounded-lg border border-line bg-paper p-2 font-mono text-[11px] text-txt" />
              <button onClick={() => copy("ei", iframeEmbed)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-txt hover:bg-wash">{copied === "ei" ? "✓" : t("Copia")}</button>
            </div>

            {/* Snippet B: script responsivo */}
            <div className="mt-3 text-xs font-medium text-dim">{t("2. Script responsivo")} <span className="font-normal text-faint">{t("(altezza automatica)")}</span></div>
            <div className="mt-1 flex items-start gap-2">
              <textarea readOnly value={scriptEmbed} rows={2} className="w-full resize-none rounded-lg border border-line bg-paper p-2 font-mono text-[11px] text-txt" />
              <button onClick={() => copy("es2", scriptEmbed)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-txt hover:bg-wash">{copied === "es2" ? "✓" : t("Copia")}</button>
            </div>
            <p className="mt-2 text-xs text-faint">{t("Lo script adatta l'altezza da solo e resta responsivo. L'iframe è più semplice ma con altezza fissa.")}</p>

            {/* Anteprima dal vivo */}
            <div className="mt-3 text-xs font-medium text-dim">{t("Anteprima dal vivo")}</div>
            <div className="mt-1 overflow-hidden rounded-lg border border-line bg-surface">
              <iframe key={embedPreviewSrc} src={embedPreviewSrc} title={t("Anteprima embed")} style={{ width: "100%", height: minH, border: 0, display: "block" }} />
            </div>
          </Card>

          <Card>
            <SectionTitle>{t("Personalizza CSS")}</SectionTitle>
            <p className="mb-2 text-xs text-dim">{t("CSS personalizzato applicato al widget. Usa il selettore")} <code className="rounded bg-wash px-1">#spigole-book</code> {t("per mirare al widget.")}</p>
            <textarea value={c.customCss} onChange={(e) => set("customCss", e.target.value)} rows={5} spellCheck={false} className="w-full resize-y rounded-lg border border-line bg-paper p-3 font-mono text-[12px] text-txt outline-none focus:border-focus" placeholder={"#spigole-book button{ text-transform:uppercase; }"} />
          </Card>
        </div>

        {/* Anteprima live (in scala reale del layout) */}
        <Card className="lg:sticky lg:top-20 lg:self-start">
          <SectionTitle>{t("Anteprima widget")} · {t(LAYOUT_LABEL(c.layout))}</SectionTitle>
          <div ref={previewWrapRef}>
          <div style={{ zoom: previewScale }}>
          <div id="spigole-book" className="mx-auto overflow-hidden border border-line bg-surface shadow-lg" style={{ borderRadius: radius, width: lay.w, fontFamily }}>
            <style>{c.customCss}</style>
            {c.showHeader && (
              <div className="px-5 py-4 text-white" style={{ backgroundColor: c.accent }}>
                <div className="text-sm opacity-90">{t("Prenotazione online")}</div>
                <div className="font-display text-xl font-bold">{structure?.name ?? t("La tua struttura")}</div>
              </div>
            )}
            {lay.orient === "v" ? (
            <div className="flex flex-col gap-3 p-5">
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-dim">{t("Arrivo")}<input type="date" value={ci} onChange={(e) => setCi(e.target.value)} className={`mt-1 ${inp}`} style={{ borderRadius: radius / 2 }} /></label>
                <label className="block text-xs font-medium text-dim">{t("Partenza")}<input type="date" value={co} onChange={(e) => setCo(e.target.value)} className={`mt-1 ${inp}`} style={{ borderRadius: radius / 2 }} /></label>
              </div>
              <div className={`grid gap-2 ${c.askChildren ? "grid-cols-3" : "grid-cols-2"}`}>
                <label className="block text-xs font-medium text-dim">{t("Adulti")}<input type="number" min={1} value={guests} onChange={(e) => setGuests(Math.max(1, +e.target.value))} className={`mt-1 ${inp}`} /></label>
                {c.askChildren && <label className="block text-xs font-medium text-dim">{t("Bambini")}<input type="number" min={0} value={children} onChange={(e) => setChildren(Math.max(0, +e.target.value))} className={`mt-1 ${inp}`} /></label>}
                <label className="block text-xs font-medium text-dim">{t("Camera")}<select value={rtId} onChange={(e) => setRtId(e.target.value)} className={`mt-1 ${inp}`}>{typesOf.map((rt) => (<option key={rt.id} value={rt.id}>{rt.name}</option>))}</select></label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-dim">{t("Cognome")}<input value={lastName} onChange={(e) => setLastName(e.target.value)} className={`mt-1 ${inp}`} /></label>
                <label className="block text-xs font-medium text-dim">{t("Nome")}<input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={`mt-1 ${inp}`} /></label>
              </div>
              <label className="block text-xs font-medium text-dim">{t("Email")}<input value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 ${inp}`} placeholder={t("opzionale")} /></label>
              {c.requirePhone && <label className="block text-xs font-medium text-dim">{t("Telefono")}<input value={phone} onChange={(e) => setPhone(e.target.value)} className={`mt-1 ${inp}`} placeholder="+39…" /></label>}
              {c.showPrices && (
                <div className="rounded-lg bg-wash px-3 py-2" style={{ borderRadius: radius / 2 }}>
                  <div className="flex items-baseline justify-between"><span className="text-sm text-dim">{n} {n === 1 ? t("notte") : t("notti")} · {rt?.name}</span><span className="font-mono text-lg font-bold text-txt">{eur(price)}</span></div>
                  {depositAmt > 0 && <div className="mt-0.5 flex items-baseline justify-between text-xs text-dim"><span>{t("Acconto")}{c.deposit === "percent" ? ` (${c.depositPct}%)` : ` (${t("prima notte")})`}</span><span className="font-mono">{eur(depositAmt)}</span></div>}
                </div>
              )}
              {doneMsg ? (
                <div className="px-3 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: "var(--ok)", borderRadius: radius / 2 }}>✓ {t("Prenotazione ricevuta! Aggiunta al calendario.")}</div>
              ) : (
                <button onClick={prenota} className="py-2.5 text-sm font-bold text-white transition hover:opacity-90" style={{ backgroundColor: c.accent, borderRadius: radius / 2 }}>{t("Prenota ora")}</button>
              )}
              <div className="text-center text-[10px] text-faint">{t("Pagamenti:")} {[c.payCard && t("Carta"), c.payPaypal && "PayPal", c.payTransfer && t("Bonifico"), c.payOnsite && t("Sul posto")].filter(Boolean).join(" · ") || "—"}</div>
            </div>
            ) : (
            <div className={`flex flex-wrap items-end gap-2 ${c.layout === "inline" ? "p-2.5" : "p-4"}`}>
              <label className="block flex-1 text-[11px] font-medium text-dim" style={{ minWidth: 120 }}>{t("Arrivo")}<input type="date" value={ci} onChange={(e) => setCi(e.target.value)} className={`mt-1 ${inp}`} style={{ borderRadius: radius / 2 }} /></label>
              <label className="block flex-1 text-[11px] font-medium text-dim" style={{ minWidth: 120 }}>{t("Partenza")}<input type="date" value={co} onChange={(e) => setCo(e.target.value)} className={`mt-1 ${inp}`} style={{ borderRadius: radius / 2 }} /></label>
              <label className="block text-[11px] font-medium text-dim" style={{ width: 68 }}>{t("Adulti")}<input type="number" min={1} value={guests} onChange={(e) => setGuests(Math.max(1, +e.target.value))} className={`mt-1 ${inp}`} /></label>
              {c.askChildren && <label className="block text-[11px] font-medium text-dim" style={{ width: 68 }}>{t("Bambini")}<input type="number" min={0} value={children} onChange={(e) => setChildren(Math.max(0, +e.target.value))} className={`mt-1 ${inp}`} /></label>}
              <label className="block flex-1 text-[11px] font-medium text-dim" style={{ minWidth: 130 }}>{t("Camera")}<select value={rtId} onChange={(e) => setRtId(e.target.value)} className={`mt-1 ${inp}`}>{typesOf.map((rt) => (<option key={rt.id} value={rt.id}>{rt.name}</option>))}</select></label>
              {c.showPrices && c.layout !== "inline" && <div className="text-right"><div className="text-[10px] text-faint">{n} {n === 1 ? t("notte") : t("notti")}</div><div className="font-mono text-lg font-bold text-txt">{eur(price)}</div></div>}
              {doneMsg ? (
                <div className="flex-1 px-3 py-2.5 text-center text-sm font-semibold text-white" style={{ backgroundColor: "var(--ok)", borderRadius: radius / 2, minWidth: 140 }}>✓ {t("Ricevuta!")}</div>
              ) : (
                <button onClick={prenota} className="px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90" style={{ backgroundColor: c.accent, borderRadius: radius / 2 }}>{t("Prenota")}</button>
              )}
            </div>
            )}
          </div>
          </div>
          </div>
          <p className="mt-2 text-center text-xs text-faint">{t("Anteprima grafica del widget. Le prenotazioni reali passano dal motore /prenota del tuo Xenosite.")}</p>
        </Card>
      </div>
    </div>
  );
}
