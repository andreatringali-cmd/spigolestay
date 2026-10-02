"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { nights, toISO, shiftISO } from "@/lib/dates";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
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
// Come viene scelto il colore del motore REALE incorporato: nessun parametro (colore Xenora),
// colore della struttura (photoColor) oppure un colore personalizzato.
type AccentMode = "default" | "structure" | "custom";
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

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
  embedMinHeight: number; embedInheritAccent: boolean; embedAccentMode?: AccentMode;
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
  embedMinHeight: 640, embedInheritAccent: true, embedAccentMode: "default",
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
// Avviso in riquadro (ok / warn / err) per gli stati del widget.
function Notice({ kind, children }: { kind: "ok" | "warn" | "err" | "info"; children: React.ReactNode }) {
  const col = kind === "ok" ? "var(--ok)" : kind === "warn" ? "var(--warn)" : kind === "err" ? "var(--err)" : "var(--line)";
  return (
    <div className="rounded-lg border px-3 py-2 text-xs text-dim" style={{ borderColor: col, background: kind === "info" ? "var(--wash)" : `color-mix(in srgb, ${col} 8%, transparent)` }}>{children}</div>
  );
}

const WKEY = "spigolestay:widgets:v1";
const PUBLIC_HOST = "xenora.it";
const publicBase = `https://${PUBLIC_HOST}`;

type PlatformKey = "html" | "wordpress" | "wix" | "squarespace";
const PLATFORMS: { key: PlatformKey; label: string; steps: string[] }[] = [
  { key: "html", label: "Sito HTML", steps: [
    "Apri il file della pagina in cui vuoi il motore di prenotazione (per esempio prenota.html).",
    "Incolla il codice nel punto esatto in cui deve comparire, dentro il tag <body>.",
    "Salva e carica il file sul tuo hosting, poi ricarica la pagina.",
  ] },
  { key: "wordpress", label: "WordPress", steps: [
    "Modifica la pagina (o l'articolo) in cui vuoi il motore.",
    "Aggiungi un blocco «HTML personalizzato» e incolla il codice.",
    "Premi Aggiorna e apri la pagina. Se il tuo ruolo o un plugin di sicurezza rimuove i tag <script>, usa l'iframe semplice.",
  ] },
  { key: "wix", label: "Wix", steps: [
    "Nell'editor aggiungi un elemento di tipo «Incorpora» / «Embed HTML» (i nomi dei menu possono variare con la versione di Wix).",
    "Scegli la modalità «Codice» e incolla l'iframe semplice (gli script esterni sono spesso bloccati).",
    "Ridimensiona il riquadro in modo che sia alto almeno quanto l'altezza minima impostata qui, quindi pubblica il sito. L'anteprima dell'editor può non mostrare il contenuto: controlla sul sito pubblicato.",
  ] },
  { key: "squarespace", label: "Squarespace", steps: [
    "Modifica la pagina e aggiungi un blocco «Codice» (Code block).",
    "Incolla il codice e disattiva l'opzione che mostra il codice come testo (altrimenti viene stampato invece di essere eseguito).",
    "Salva e controlla la pagina pubblicata; se lo script non compare, usa l'iframe semplice.",
  ] },
];

interface PubRow { slug: string; updatedAt: string | null }

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

  // Cambiando struttura in alto, si chiude l'editor se il widget aperto appartiene a un'altra struttura.
  useEffect(() => { if (editingId && activeStructureId !== "all" && c && c.structureId !== activeStructureId) setEditingId(null); }, [activeStructureId, editingId, c]);

  // Lista filtrata per la struttura selezionata in alto ("Tutte" = tutti i widget).
  const shownWidgets = activeStructureId === "all" ? widgets : widgets.filter((w) => w.structureId === activeStructureId);
  const defStructId = activeStructureId !== "all" && structures.some((s) => s.id === activeStructureId) ? activeStructureId : (structures[0]?.id ?? "");
  const defStructName = structures.find((s) => s.id === defStructId)?.name ?? "Widget";
  const createWidget = () => { const w = makeCfg(defStructId, `${defStructName} ${widgets.length + 1}`); setWidgets((p) => [...p, w]); setEditingId(w.id); };
  const deleteWidget = (id: string) => setWidgets((p) => p.filter((w) => w.id !== id));

  // ── Stato di pubblicazione di TUTTE le strutture dell'utente (una query, filtrata per i suoi id:
  // public_sites è leggibile pubblicamente, quindi niente select senza filtro). ──
  const [pub, setPub] = useState<Record<string, PubRow>>({});
  const [pubState, setPubState] = useState<"loading" | "ok" | "error" | "offline">("loading");
  const structIdsKey = structures.map((s) => s.id).join("|");
  const loadPub = useCallback(async () => {
    if (!supabase) { setPubState("offline"); return; }
    const ids = structIdsKey ? structIdsKey.split("|") : [];
    if (!ids.length) { setPub({}); setPubState("ok"); return; }
    setPubState("loading");
    try {
      const { data, error } = await supabase.from("public_sites").select("structure_id, slug, updated_at").in("structure_id", ids);
      if (error) { setPubState("error"); return; }
      const m: Record<string, PubRow> = {};
      for (const r of (data ?? []) as { structure_id: string; slug: string; updated_at: string | null }[]) if (r.slug) m[r.structure_id] = { slug: r.slug, updatedAt: r.updated_at };
      setPub(m); setPubState("ok");
    } catch { setPubState("error"); }
  }, [structIdsKey]);
  useEffect(() => { loadPub(); }, [loadPub]);

  // ── stato anteprima interattiva (simulatore grafico) ──
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
  const [copyErr, setCopyErr] = useState("");
  useEffect(() => { if (typesOf.length && !typesOf.some((x) => x.id === rtId)) setRtId(typesOf[0].id); }, [typesOf, rtId]);

  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  const [previewTab, setPreviewTab] = useState<"real" | "sim">("real");
  useEffect(() => {
    const el = previewWrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setAvailW(el.clientWidth));
    ro.observe(el); setAvailW(el.clientWidth);
    return () => ro.disconnect();
  }, [editingId, previewTab]);

  // Anteprima del motore REALE: larghezza simulata (telefono/tablet/desktop) + altezza dal postMessage del motore.
  const [viewport, setViewport] = useState<"mobile" | "tablet" | "desktop">("desktop");
  const [reloadTick, setReloadTick] = useState(0);
  const [liveState, setLiveState] = useState<{ k: string; h: number }>({ k: "", h: 0 });
  const liveKeyRef = useRef("");
  const [platform, setPlatform] = useState<PlatformKey>("html");
  const [snippetKind, setSnippetKind] = useState<"script" | "iframe">("script");
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data as { type?: string; height?: number } | null;
      if (d && d.type === "xenora-embed-height" && typeof d.height === "number" && d.height > 100) setLiveState({ k: liveKeyRef.current, h: Math.round(d.height) });
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  // Altezza adattata valida solo per la combinazione struttura/ricarica/larghezza corrente (niente reset in effect).
  const liveKey = `${structureId}|${reloadTick}|${viewport}|${editingId}`;
  useEffect(() => { liveKeyRef.current = liveKey; }, [liveKey]);
  const liveH = liveState.k === liveKey ? liveState.h : 0;

  const structure = structures.find((s) => s.id === structureId);
  const structureMissing = !!c && !structure;
  const rt = roomTypes.find((r) => r.id === rtId);
  const n = Math.max(1, nights(ci, co));
  const fontFamily = useMemo(() => (c && c.font !== "system" ? c.font : undefined), [c]);

  const pubInfo = pub[structureId] ?? null;
  const publishedSlug = pubInfo?.slug ?? null;
  const publishedAtTxt = pubInfo?.updatedAt ? new Date(pubInfo.updatedAt).toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  // Modifiche alla struttura/camere successive all'ultima pubblicazione: l'embed mostra la copia pubblicata, non i dati live.
  const staleSince = useMemo(() => {
    if (!pubInfo?.updatedAt) return false;
    const pubTs = Date.parse(pubInfo.updatedAt);
    if (isNaN(pubTs)) return false;
    const last = Math.max(structure?.updatedAt ?? 0, ...typesOf.map((r) => (r as { updatedAt?: number }).updatedAt ?? 0));
    return last > pubTs + 60_000;
  }, [pubInfo, structure, typesOf]);

  // QR del link diretto (solo se la struttura è pubblicata).
  const [qrState, setQrState] = useState<{ url: string; data: string }>({ url: "", data: "" });
  const directUrl = publishedSlug ? `${publicBase}/prenota?site=${encodeURIComponent(publishedSlug)}` : "";
  useEffect(() => {
    let alive = true;
    if (!directUrl) return;
    QRCode.toDataURL(directUrl, { margin: 1, width: 320, errorCorrectionLevel: "M" }).then((u) => { if (alive) setQrState({ url: directUrl, data: u }); }).catch(() => { if (alive) setQrState({ url: directUrl, data: "" }); });
    return () => { alive = false; };
  }, [directUrl]);
  const qr = qrState.url === directUrl ? qrState.data : "";

  const copy = (k: string, txt: string) => {
    setCopyErr("");
    const done = () => { setCopied(k); window.setTimeout(() => setCopied((cur) => (cur === k ? "" : cur)), 1600); };
    try {
      if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(txt).then(done, () => setCopyErr("Copia non riuscita: seleziona il testo e copialo a mano.")); return; }
    } catch {}
    setCopyErr("Copia non riuscita: seleziona il testo e copialo a mano.");
  };

  if (!loaded) return <div><PageHeader title={t("Widget sito")} subtitle="" /></div>;

  // ═══════════ LISTA WIDGET ═══════════
  if (!c) {
    const badge = (sid: string) => {
      if (pubState === "loading") return <span className="text-faint">…</span>;
      if (pubState !== "ok") return <span className="text-faint">—</span>;
      return pub[sid]
        ? <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: "var(--ok)" }}>Online</span>
        : <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-faint">Non pubblicato</span>;
    };
    return (
      <div>
        <PageHeader title={t("Widget sito")} subtitle={t("Crea uno o più widget di prenotazione per il tuo sito")}
          actions={<button onClick={createWidget} disabled={!structures.length} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">+ {t("Crea un nuovo widget")}</button>} />
        {pubState === "error" && <div className="mb-3"><Notice kind="warn">Non riesco a leggere lo stato di pubblicazione delle strutture (errore di rete o di accesso). Puoi comunque configurare i widget; lo stato Online/Non pubblicato non è verificato. <button onClick={loadPub} className="font-semibold text-focus hover:underline">Riprova</button></Notice></div>}
        {pubState === "offline" && <div className="mb-3"><Notice kind="info">Non sei connesso al server: lo stato di pubblicazione non è disponibile.</Notice></div>}
        <Card>
          {!structures.length ? (
            <EmptyState title="Nessuna struttura" sub="Crea prima una struttura (menu Strutture): il widget di prenotazione si collega a una struttura." />
          ) : shownWidgets.length === 0 ? (
            <EmptyState title={t("Nessun widget per questa struttura.")} sub="Con «+ Crea un nuovo widget» ottieni il codice da incollare nel tuo sito: il motore di prenotazione compare nella pagina e le prenotazioni entrano nel calendario." />
          ) : (
            <>
              {/* Telefono: lista a schede (tap affidabile; niente tabella larga da scorrere) */}
              <div className="flex flex-col gap-2 md:hidden">
                {shownWidgets.map((w) => (
                  <button key={w.id} onClick={() => setEditingId(w.id)} className="block w-full rounded-xl border border-line bg-surface p-3 text-left shadow-sm active:bg-wash">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-txt">{w.name || "—"}</span>
                      <span className="flex shrink-0 items-center gap-2">{badge(w.structureId)}<span className="text-faint">›</span></span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
                      <span>{structures.find((s) => s.id === w.structureId)?.name ?? "Struttura non trovata"}</span>
                      <span className="text-faint">·</span>
                      <span className="inline-flex items-center gap-1"><span className="h-3.5 w-3.5 shrink-0 rounded-full border border-line" style={{ backgroundColor: w.accent }} /><span className="font-mono">{w.accent}</span></span>
                    </div>
                  </button>
                ))}
              </div>
              {/* Tabella (tablet/desktop) */}
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[680px] text-sm">
                <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-semibold">{t("Nome")}</th><th className="py-2 pr-3 font-semibold">{t("Struttura")}</th><th className="py-2 pr-3 font-semibold">Stato</th><th className="py-2 pr-3 font-semibold">{t("Colore")}</th><th className="py-2 pr-3 font-semibold">Altezza min.</th><th className="py-2 text-right font-semibold"></th>
                </tr></thead>
                <tbody>
                  {shownWidgets.map((w) => (
                    <tr key={w.id} onClick={() => setEditingId(w.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                      <td className="py-2.5 pr-3 font-medium text-txt">{w.name || "—"}</td>
                      <td className="py-2.5 pr-3 text-dim">{structures.find((s) => s.id === w.structureId)?.name ?? <span className="text-[color:var(--err)]">Struttura non trovata</span>}</td>
                      <td className="py-2.5 pr-3">{badge(w.structureId)}</td>
                      <td className="py-2.5 pr-3"><span className="inline-flex items-center gap-1.5 text-dim"><span className="h-4 w-4 shrink-0 rounded-full border border-line" style={{ backgroundColor: w.accent }} /><span className="font-mono text-xs">{(w.embedAccentMode ?? (w.embedInheritAccent === false ? "custom" : "default")) === "custom" ? w.accent : (w.embedAccentMode ?? "default") === "structure" ? "da struttura" : "predefinito"}</span></span></td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-dim">{w.embedMinHeight ?? 640}px</td>
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
  // Simulatore: se la struttura non ha tipologie NON si inventa un prezzo (prima ricadeva su 100 €).
  const hasPrice = !!rt && typeof rt.basePrice === "number";
  const raw = hasPrice ? (rt!.basePrice as number) * n : 0;
  const price = c.adjMode === "fixed" ? Math.max(0, raw + c.adjValue) : c.adjMode === "percent" ? Math.max(0, Math.round(raw * (1 + c.adjValue / 100))) : raw;
  const depositAmt = !hasPrice ? 0 : c.deposit === "firstNight" ? (rt!.basePrice as number) : c.deposit === "percent" ? Math.round(price * c.depositPct / 100) : 0;
  const priceTxt = hasPrice ? eur(price) : "—";

  // Anteprima: SIMULA la prenotazione (mostra la conferma) SENZA creare dati reali.
  const prenota = () => {
    if (!lastName.trim() && !firstName.trim()) return;
    setDoneMsg(true);
    window.setTimeout(() => { setDoneMsg(false); setLastName(""); setFirstName(""); setEmail(""); setPhone(""); }, 3500);
  };

  const lay = LAYOUTS.find((l) => l.key === c.layout) ?? LAYOUTS[0];
  const radius = c.theme === "rounded" ? 16 : 4;
  const previewScale = availW ? Math.min(1, availW / lay.w) : 1;

  // ── Snippet EMBED reale (motore /prenota → route pubblica /embed/<slug>) ──
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const minH = Math.max(200, c.embedMinHeight ?? 640);
  const accentMode: AccentMode = c.embedAccentMode ?? (c.embedInheritAccent === false ? "custom" : "default");
  const structColor = HEX_RE.test((structure?.photoColor ?? "").trim()) ? (structure!.photoColor as string).trim() : "";
  const effAccent = accentMode === "custom" ? (HEX_RE.test(c.accent) ? c.accent : "") : accentMode === "structure" ? structColor : "";
  const swatch = effAccent || "var(--focus)";
  // Slug reale se pubblicato; altrimenti l'anteprima dello slug per far vedere la forma dello snippet.
  const embedSlug = publishedSlug || slugify(structure?.name || "") || "la-tua-struttura";
  const embedUrl = `${publicBase}/embed/${embedSlug}`;
  const iframeEmbed = `<iframe src="${embedUrl}${effAccent ? `?accent=${encodeURIComponent(effAccent)}` : ""}" style="width:100%;height:${minH}px;border:0" loading="lazy" allow="payment" title="Prenota — ${(structure?.name ?? "").replace(/"/g, "&quot;")}"></iframe>`;
  const scriptEmbed = `<script src="${publicBase}/embed.js" data-site="${embedSlug}"${minH !== 640 ? ` data-min-height="${minH}"` : ""}${effAccent ? ` data-accent="${effAccent}"` : ""}></script>`;
  const shownSnippet = snippetKind === "script" ? scriptEmbed : iframeEmbed;
  // Anteprima dal vivo: usa il motore in modalità embed con i dati locali del proprietario
  // (nessuna pubblicazione necessaria per vedere l'anteprima).
  const embedPreviewSrc = `${origin}/prenota?embed=1&s=${encodeURIComponent(structureId)}${effAccent ? `&accent=${encodeURIComponent(effAccent)}` : ""}`;
  const vpW = viewport === "mobile" ? 390 : viewport === "tablet" ? 768 : 0;
  const previewH = Math.max(minH, liveH);

  // Pagina di prova: una pagina HTML minimale che incorpora lo snippet script come farebbe il sito del cliente.
  const openTestPage = () => {
    const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prova widget — ${(structure?.name ?? "").replace(/</g, "")}</title><style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#222;line-height:1.5}h1{font-size:20px}.note{background:#f4f4f4;border-radius:8px;padding:10px 12px;font-size:13px;color:#555;margin:12px 0 20px}</style></head><body><h1>Pagina di prova del widget</h1><div class="note">Questa pagina carica il motore reale da ${PUBLIC_HOST}, come farebbe il tuo sito. Se vedi «Motore di prenotazione non disponibile» la struttura non è pubblicata. Le prenotazioni fatte qui sono reali.</div>\n${scriptEmbed}\n</body></html>`;
    try {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const w = window.open(url, "_blank", "noopener");
      if (!w) setCopyErr("Il browser ha bloccato la finestra: consenti i popup per questo sito e riprova.");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setCopyErr("Non riesco ad aprire la pagina di prova."); }
  };
  const downloadQr = () => { if (!qr) return; const a = document.createElement("a"); a.href = qr; a.download = `qr-prenotazione-${embedSlug}.png`; a.click(); };

  const platformSteps = PLATFORMS.find((p) => p.key === platform) ?? PLATFORMS[0];

  return (
    <div>
      <PageHeader title={c.name || t("Widget")} subtitle={t("Configura il widget; le prenotazioni entrano dirette nel calendario")}
        actions={<div className="flex flex-wrap items-center gap-2"><button onClick={() => setEditingId(null)} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">← {t("Torna alla lista")}</button><button onClick={async () => { if (c && await ask({ title: t("Elimina widget"), message: `${t("Eliminare")} "${c.name || t("Widget")}"?`, danger: true, confirmLabel: t("Elimina") })) { deleteWidget(c.id); setEditingId(null); } }} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button><button onClick={() => setEditingId(null)} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Salva")}</button></div>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {/* 1. Impostazioni del motore reale */}
          <Card>
            <SectionTitle>Impostazioni</SectionTitle>
            <label className="block text-xs font-medium text-dim">{t("Nome")} <span className="font-normal text-faint">(solo per riconoscerlo qui)</span>
              <input value={c.name} onChange={(e) => set("name", e.target.value)} className={`mt-1 ${inp}`} placeholder={t("Es. Widget sito ufficiale")} />
            </label>
            <label className="mt-2 block text-xs font-medium text-dim">{t("Struttura")}
              <select value={structureMissing ? "" : structureId} onChange={(e) => set("structureId", e.target.value)} className={`mt-1 ${inp}`}>
                {structureMissing && <option value="">— scegli una struttura —</option>}
                {structures.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </label>
            {structureMissing && <div className="mt-2"><Notice kind="err">La struttura di questo widget non esiste più. Scegline un&apos;altra per ottenere un codice valido.</Notice></div>}

            <div className="mt-3 text-xs font-medium text-dim">Colore del motore di prenotazione</div>
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg border border-line p-0.5">
              {([["default", "Predefinito"], ["structure", "Colore struttura"], ["custom", "Personalizzato"]] as const).map(([k, lab]) => (
                <button key={k} onClick={() => { set("embedAccentMode", k); set("embedInheritAccent", k === "default"); }} className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${accentMode === k ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{lab}</button>
              ))}
            </div>
            {accentMode === "custom" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {ACCENTS.map((col) => (<button key={col} onClick={() => set("accent", col)} title={col} className="h-7 w-7 rounded-full transition" style={{ backgroundColor: col, outline: c.accent === col ? "2px solid var(--txt)" : "none", outlineOffset: 2 }} />))}
                <input type="color" value={HEX_RE.test(c.accent) && c.accent.length === 7 ? c.accent : "#4F46E5"} onChange={(e) => set("accent", e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-line bg-paper" title="Scegli un colore" />
                <input value={c.accent} onChange={(e) => set("accent", e.target.value.trim())} className="w-24 rounded-lg border border-line bg-paper px-2 py-1 font-mono text-xs text-txt outline-none focus:border-focus" placeholder="#RRGGBB" spellCheck={false} />
              </div>
            )}
            {accentMode === "custom" && !HEX_RE.test(c.accent) && <div className="mt-2"><Notice kind="warn">Colore non valido: scrivilo come #RRGGBB (per esempio #B4531F). Finché non è valido il motore usa il colore predefinito.</Notice></div>}
            {accentMode === "structure" && !structColor && <div className="mt-2"><Notice kind="warn">Questa struttura non ha un colore impostato: il motore userà quello predefinito. Impostalo nella scheda della struttura oppure scegli «Personalizzato».</Notice></div>}
            <div className="mt-2 flex items-center gap-2 text-[11px] text-faint"><span className="h-4 w-4 rounded-full border border-line" style={{ backgroundColor: swatch }} />{effAccent ? `Colore applicato: ${effAccent}` : "Colore applicato: predefinito di Xenora"}</div>

            <label className="mt-3 block text-xs font-medium text-dim">{t("Altezza minima (px)")}
              <input type="number" min={200} step={20} value={c.embedMinHeight ?? 640} onChange={(e) => set("embedMinHeight", Math.max(200, +e.target.value || 640))} className={`mt-1 ${inp}`} />
              <span className="mt-0.5 block text-[11px] font-normal text-faint">Con lo script l&apos;altezza si adatta da sola e questo è il minimo; con l&apos;iframe semplice è l&apos;altezza fissa.</span>
            </label>
          </Card>

          {/* 2. Pubblica e incolla */}
          <Card>
            <SectionTitle>Incorpora sul tuo sito</SectionTitle>
            <p className="mb-3 text-xs text-dim">{t("Mostra il motore di prenotazione di")} <b className="text-txt">{structure?.name ?? t("la tua struttura")}</b> {t("dentro il tuo sito esterno. Le prenotazioni arrivano dirette nel gestionale.")}</p>

            {/* Stato pubblicazione */}
            <div className="mb-3 space-y-2">
              {pubState === "loading" && <Notice kind="info">Controllo lo stato di pubblicazione…</Notice>}
              {pubState === "offline" && <Notice kind="warn">Non sei connesso al server: non posso verificare se la struttura è pubblicata.</Notice>}
              {pubState === "error" && <Notice kind="warn">Non riesco a verificare la pubblicazione (errore di rete o di accesso). <button onClick={loadPub} className="font-semibold text-focus hover:underline">Riprova</button></Notice>}
              {pubState === "ok" && publishedSlug && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-wash px-3 py-2 text-xs">
                  <span className="rounded-full px-2 py-0.5 font-semibold text-white" style={{ backgroundColor: "var(--ok)" }}>{t("Online")}</span>
                  <span className="text-dim">{PUBLIC_HOST}/embed/</span><span className="font-mono font-semibold text-txt">{publishedSlug}</span>
                  {publishedAtTxt && <span className="text-faint">· ultima pubblicazione {publishedAtTxt}</span>}
                </div>
              )}
              {pubState === "ok" && !publishedSlug && (
                <Notice kind="warn">{t("Questa struttura non è ancora pubblicata.")} Finché non la pubblichi, il codice qui sotto mostra solo «Motore di prenotazione non disponibile». <Link href="/sito" className="font-semibold text-focus hover:underline">{t("Pubblica il tuo Xenosite")}</Link> {t("per attivare l'indirizzo dello snippet.")}</Notice>
              )}
              {pubState === "ok" && publishedSlug && staleSince && (
                <Notice kind="warn">Hai modificato struttura o camere dopo l&apos;ultima pubblicazione: il widget sul tuo sito mostra ancora la copia pubblicata. <Link href="/sito" className="font-semibold text-focus hover:underline">Ripubblica dal tuo Xenosite</Link> per aggiornarla.</Notice>
              )}
              {typesOf.length === 0 && <Notice kind="err">Questa struttura non ha tipologie di camera: il motore non avrebbe nulla da vendere. Aggiungile in Camere.</Notice>}
            </div>

            {/* Scelta metodo */}
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-line p-0.5">
              <button onClick={() => setSnippetKind("script")} className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${snippetKind === "script" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>Script responsivo (consigliato)</button>
              <button onClick={() => setSnippetKind("iframe")} className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${snippetKind === "iframe" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>Iframe semplice</button>
            </div>
            <p className="mt-1.5 text-[11px] text-faint">{snippetKind === "script" ? "Lo script adatta l'altezza da solo e resta responsivo, senza barre di scorrimento interne. Alcuni costruttori di siti (es. Wix) bloccano gli script esterni: in quel caso usa l'iframe." : "L'iframe funziona quasi ovunque ma ha altezza fissa: se il contenuto è più alto compare una barra di scorrimento interna."}</p>
            <div className="mt-2 flex items-start gap-2">
              <textarea readOnly value={shownSnippet} rows={4} onFocus={(e) => e.currentTarget.select()} className="w-full resize-none rounded-lg border border-line bg-paper p-2 font-mono text-[11px] text-txt" />
              <button onClick={() => copy("snip", shownSnippet)} className="shrink-0 rounded-lg bg-focus px-3 py-2 text-xs font-semibold text-white hover:opacity-90">{copied === "snip" ? "Copiato ✓" : t("Copia")}</button>
            </div>
            {copyErr && <div className="mt-2"><Notice kind="err">{copyErr}</Notice></div>}

            {/* Istruzioni per piattaforma */}
            <div className="mt-4 text-xs font-medium text-dim">Come incollarlo</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {PLATFORMS.map((p) => (<button key={p.key} onClick={() => setPlatform(p.key)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${platform === p.key ? "bg-focus text-white" : "border border-line text-dim hover:bg-wash"}`}>{p.label}</button>))}
            </div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-dim">
              {platformSteps.steps.map((st, i) => <li key={i}>{st}</li>)}
            </ol>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-focus">Qualcosa non va? Controlli rapidi</summary>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-dim">
                <li><b className="text-txt">Non compare nulla:</b> il tuo sito potrebbe bloccare gli script. Prova l&apos;iframe semplice.</li>
                <li><b className="text-txt">«Motore di prenotazione non disponibile»:</b> la struttura non è pubblicata (o lo slug è cambiato). Pubblicala dal tuo Xenosite e ricopia il codice.</li>
                <li><b className="text-txt">Scorrimento interno / altezza tagliata:</b> aumenta l&apos;altezza minima o passa allo script responsivo.</li>
                <li><b className="text-txt">Camere o prezzi vecchi:</b> il widget mostra l&apos;ultima copia pubblicata; ripubblica dopo ogni modifica importante.</li>
                <li><b className="text-txt">Su telefono:</b> prova sempre la pagina dal cellulare; usa il selettore «Telefono» nell&apos;anteprima qui accanto per un controllo veloce.</li>
              </ul>
            </details>

            {/* Prova e condividi */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={openTestPage} disabled={!publishedSlug} title={publishedSlug ? "Apre una pagina vuota che incorpora lo snippet script, come farebbe il tuo sito" : "Disponibile dopo la pubblicazione della struttura"} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40">Apri pagina di prova ↗</button>
              {directUrl && <a href={directUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-txt hover:bg-wash">Apri la pagina di prenotazione ↗</a>}
            </div>
            {directUrl && (
              <div className="mt-3 rounded-lg border border-line bg-paper p-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Link diretto (social, WhatsApp, QR in struttura)</div>
                <div className="mt-1 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="break-all font-mono text-[11px] text-txt">{directUrl}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => copy("direct", directUrl)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{copied === "direct" ? "Copiato ✓" : "Copia link"}</button>
                      {qr && <button onClick={downloadQr} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Scarica QR</button>}
                    </div>
                  </div>
                  {qr && /* eslint-disable-next-line @next/next/no-img-element */ <img src={qr} alt="QR del link di prenotazione" className="h-20 w-20 shrink-0 rounded bg-white p-1" />}
                </div>
              </div>
            )}
          </Card>

          {/* 3. Simulatore grafico (non influenza il motore reale) */}
          <details className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-txt">Simulatore grafico <span className="text-xs font-normal text-faint">· solo anteprima: queste opzioni NON cambiano il motore reale</span></summary>
            <p className="mt-2 text-xs text-dim">Il motore incorporato usa le regole della struttura (piani tariffari, acconti, pagamenti, soggiorno minimo). Qui puoi solo provare layout, tema, font e CSS di una simulazione grafica, visibile nella scheda «Simulatore» dell&apos;anteprima.</p>
            <div className="mt-3 flex flex-col gap-4">
              <Card>
                <SectionTitle>{t("Aspetto")}</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
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
                <div className="mt-2 divide-y divide-[color:var(--line)]">
                  <Rowt label={t("Mostra intestazione")}><Toggle on={c.showHeader} onChange={(v) => set("showHeader", v)} /></Rowt>
                  <Rowt label={t("Mostra i prezzi")}><Toggle on={c.showPrices} onChange={(v) => set("showPrices", v)} /></Rowt>
                  <Rowt label={t("Chiedi il numero di bambini")}><Toggle on={c.askChildren} onChange={(v) => set("askChildren", v)} /></Rowt>
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
                <SectionTitle>{t("Personalizza CSS")}</SectionTitle>
                <p className="mb-2 text-xs text-dim">{t("CSS personalizzato applicato al widget. Usa il selettore")} <code className="rounded bg-wash px-1">#spigole-book</code> {t("per mirare al widget.")} Vale solo per il simulatore: il motore reale sta in un iframe e non è stilabile dal tuo sito.</p>
                <textarea value={c.customCss} onChange={(e) => set("customCss", e.target.value)} rows={5} spellCheck={false} className="w-full resize-y rounded-lg border border-line bg-paper p-3 font-mono text-[12px] text-txt outline-none focus:border-focus" placeholder={"#spigole-book button{ text-transform:uppercase; }"} />
              </Card>
            </div>
          </details>
        </div>

        {/* Anteprima (motore reale | simulatore) */}
        <Card className="lg:sticky lg:top-20 lg:self-start">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-wash p-0.5 text-xs">
              {([["real", "Motore reale"], ["sim", "Simulatore"]] as const).map(([k, lab]) => (
                <button key={k} onClick={() => setPreviewTab(k)} className={`rounded-md px-3 py-1.5 font-semibold transition ${previewTab === k ? "bg-focus text-white shadow-sm" : "text-dim hover:text-txt"}`}>{lab}</button>
              ))}
            </div>
            {previewTab === "real" && (
              <div className="flex items-center gap-1">
                {([["mobile", "Telefono"], ["tablet", "Tablet"], ["desktop", "Desktop"]] as const).map(([k, lab]) => (
                  <button key={k} onClick={() => setViewport(k)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${viewport === k ? "bg-focus text-white" : "border border-line text-dim hover:bg-wash"}`}>{lab}</button>
                ))}
                <button onClick={() => setReloadTick((x) => x + 1)} title="Ricarica l'anteprima" className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-dim hover:bg-wash">↻</button>
              </div>
            )}
          </div>

          {previewTab === "real" ? (
            structureMissing || !structureId ? (
              <EmptyState title="Nessuna struttura selezionata" sub="Scegli una struttura per vedere il motore di prenotazione." />
            ) : typesOf.length === 0 ? (
              <EmptyState title="Nessuna tipologia di camera" sub="Questa struttura non ha camere in vendita: il motore resterebbe vuoto. Aggiungi le tipologie in Camere." />
            ) : (
              <>
                <div className="mb-2"><Notice kind="warn">L&apos;anteprima usa i tuoi dati reali: se completi una prenotazione di prova qui, viene registrata davvero nel calendario (annullala poi da Prenotazioni). Per provare senza effetti usa solo la ricerca delle camere.</Notice></div>
                <div className="overflow-auto rounded-lg border border-line bg-surface">
                  <div className="mx-auto" style={{ width: vpW ? vpW : "100%", maxWidth: "100%" }}>
                    <iframe key={`${embedPreviewSrc}|${reloadTick}`} src={embedPreviewSrc} title={t("Anteprima embed")} style={{ width: "100%", height: previewH, border: 0, display: "block" }} />
                  </div>
                </div>
                <p className="mt-2 text-center text-xs text-faint">Motore reale in modalità incorporata{effAccent ? ` · colore ${effAccent}` : ""} · larghezza {vpW ? `${vpW}px` : "piena"} · altezza {previewH}px{liveH ? " (adattata al contenuto)" : ""}.</p>
              </>
            )
          ) : (
            <>
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
                    <label className="block text-xs font-medium text-dim">{t("Camera")}<select value={rtId} onChange={(e) => setRtId(e.target.value)} className={`mt-1 ${inp}`}>{typesOf.length === 0 && <option value="">Nessuna camera</option>}{typesOf.map((rt) => (<option key={rt.id} value={rt.id}>{rt.name}</option>))}</select></label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs font-medium text-dim">{t("Cognome")}<input value={lastName} onChange={(e) => setLastName(e.target.value)} className={`mt-1 ${inp}`} /></label>
                    <label className="block text-xs font-medium text-dim">{t("Nome")}<input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={`mt-1 ${inp}`} /></label>
                  </div>
                  <label className="block text-xs font-medium text-dim">{t("Email")}<input value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 ${inp}`} placeholder={t("opzionale")} /></label>
                  {c.requirePhone && <label className="block text-xs font-medium text-dim">{t("Telefono")}<input value={phone} onChange={(e) => setPhone(e.target.value)} className={`mt-1 ${inp}`} placeholder="+39…" /></label>}
                  {c.showPrices && (
                    <div className="rounded-lg bg-wash px-3 py-2" style={{ borderRadius: radius / 2 }}>
                      <div className="flex items-baseline justify-between"><span className="text-sm text-dim">{n} {n === 1 ? t("notte") : t("notti")} · {rt?.name ?? "—"}</span><span className="font-mono text-lg font-bold text-txt">{priceTxt}</span></div>
                      {depositAmt > 0 && <div className="mt-0.5 flex items-baseline justify-between text-xs text-dim"><span>{t("Acconto")}{c.deposit === "percent" ? ` (${c.depositPct}%)` : ` (${t("prima notte")})`}</span><span className="font-mono">{eur(depositAmt)}</span></div>}
                    </div>
                  )}
                  {doneMsg ? (
                    <div className="px-3 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: "var(--ok)", borderRadius: radius / 2 }}>✓ Simulazione: nessuna prenotazione è stata creata.</div>
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
                  <label className="block flex-1 text-[11px] font-medium text-dim" style={{ minWidth: 130 }}>{t("Camera")}<select value={rtId} onChange={(e) => setRtId(e.target.value)} className={`mt-1 ${inp}`}>{typesOf.length === 0 && <option value="">Nessuna camera</option>}{typesOf.map((rt) => (<option key={rt.id} value={rt.id}>{rt.name}</option>))}</select></label>
                  {c.showPrices && c.layout !== "inline" && <div className="text-right"><div className="text-[10px] text-faint">{n} {n === 1 ? t("notte") : t("notti")}</div><div className="font-mono text-lg font-bold text-txt">{priceTxt}</div></div>}
                  {doneMsg ? (
                    <div className="flex-1 px-3 py-2.5 text-center text-sm font-semibold text-white" style={{ backgroundColor: "var(--ok)", borderRadius: radius / 2, minWidth: 140 }}>✓ Simulazione</div>
                  ) : (
                    <button onClick={prenota} className="px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90" style={{ backgroundColor: c.accent, borderRadius: radius / 2 }}>{t("Prenota")}</button>
                  )}
                </div>
                )}
              </div>
              </div>
              </div>
              <p className="mt-2 text-center text-xs text-faint">Simulazione grafica: non crea prenotazioni e non cambia il motore reale (vedi la scheda «Motore reale»).{!hasPrice ? " Nessun prezzo mostrato perché la struttura non ha tipologie di camera." : ""}</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
