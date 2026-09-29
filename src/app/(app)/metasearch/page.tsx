"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { effectiveBase } from "@/lib/pricing";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle, StatCard } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { slugify } from "@/lib/publicdata";

const META = [
  { key: "google", name: "Google Hotel Ads", desc: "Comparatore n°1: appare nella scheda Google e Maps.", color: "#4285F4" },
  { key: "trivago", name: "Trivago", desc: "Metasearch europeo, forte sul mercato DACH.", color: "#E32851" },
  { key: "tripadvisor", name: "Tripadvisor", desc: "Recensioni + confronto prezzi diretti.", color: "#34E0A1" },
  { key: "trip", name: "Trip.com", desc: "Copertura sul mercato asiatico.", color: "#287DFA" },
  { key: "kayak", name: "Kayak", desc: "Aggregatore viaggi USA/EU.", color: "#FF690F" },
];

// Icone ufficiali dei comparatori (simple-icons). Kayak non ha un'icona single-color
// affidabile in quella libreria: resta l'iniziale su sfondo colorato come fallback onesto.
const META_ICON_PATHS: Record<string, string> = {
  trivago: "M7.8112 0a.2537.2537 0 0 0-.1336.0416L2.8311 3.1804a.4265.4265 0 0 0-.1947.3579v9.285c0 .141.1144.2554.2555.2554h5.1808l10.358-5.7274a.4263.4263 0 0 0 .22-.3732V1.6774c0-.1949-.2092-.3182-.3797-.2239L8.0727 7.0923V.2563c0-.1521-.1265-.2589-.2615-.2563zm.0172 14.7072-4.9307.0002c-.1457 0-.2607.1216-.2555.2672C2.822 19.9896 6.9445 24 12.0032 24c5.059 0 9.18-4.01 9.3602-9.0246.0053-.1461-.1102-.2682-.2564-.2682h-4.9319c-.1312 0-.2442.1073-.2545.238-.1592 2.025-1.8517 3.6185-3.9173 3.6185-2.4784 0-3.4806-2.1046-3.4808-2.105-.3197-.6025-.4129-1.1898-.4394-1.5183a.255.255 0 0 0-.2547-.2332Z",
  tripadvisor: "M12.006 4.295c-2.67 0-5.338.784-7.645 2.353H0l1.963 2.135a5.997 5.997 0 0 0 4.04 10.43 5.976 5.976 0 0 0 4.075-1.6L12 19.705l1.922-2.09a5.972 5.972 0 0 0 4.072 1.598 6 6 0 0 0 6-5.998 5.982 5.982 0 0 0-1.957-4.432L24 6.648h-4.35a13.573 13.573 0 0 0-7.644-2.353zM12 6.255c1.531 0 3.063.303 4.504.903C13.943 8.138 12 10.43 12 13.1c0-2.671-1.942-4.962-4.504-5.942A11.72 11.72 0 0 1 12 6.256zM6.002 9.157a4.059 4.059 0 1 1 0 8.118 4.059 4.059 0 0 1 0-8.118zm11.992.002a4.057 4.057 0 1 1 .003 8.115 4.057 4.057 0 0 1-.003-8.115zm-11.992 1.93a2.128 2.128 0 0 0 0 4.256 2.128 2.128 0 0 0 0-4.256zm11.992 0a2.128 2.128 0 0 0 0 4.256 2.128 2.128 0 0 0 0-4.256z",
  trip: "M17.834 9.002c-.68 0-1.29.31-1.707.799v-.514h-1.708v8.348h1.897v-2.923c.416.344.943.551 1.518.551 1.677 0 3.036-1.401 3.036-3.13s-1.36-3.13-3.036-3.13zm-.19 4.516c-.733 0-1.328-.62-1.328-1.385s.595-1.385 1.328-1.385c.734 0 1.328.62 1.328 1.385s-.594 1.385-1.328 1.385zm6.356.607a1.138 1.138 0 1 1-2.277 0 1.138 1.138 0 0 1 2.277 0zM13.205 7.428a1.062 1.062 0 1 1-2.125 0 1.062 1.062 0 0 1 2.125 0zm-2.011 1.859h1.897v5.692h-1.897V9.287zM6.83 8.225H4.364v6.754H2.466V8.225H0V6.63h6.83v1.594zm3.035 1.033c.13 0 .255.012.38.03v1.74a1.55 1.55 0 0 0-.297-.031c-.88 0-1.594.612-1.594 1.593v2.389H6.451V9.287h1.707v.9c.363-.558.991-.93 1.707-.93z",
};

// Google usa la "G" ufficiale a 4 colori (stessa di src/app/login/page.tsx) invece del colore piatto.
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.3 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 6.9-9.6 6.9-16.9z" />
      <path fill="#FBBC05" d="M10.3 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.3-4.6 2.1-7.9 2.1-6.4 0-11.8-3.8-13.7-9.4l-7.8 6.1C6.4 42.6 14.6 48 24 48z" />
    </svg>
  );
}

// Badge icona di un comparatore: logo ufficiale su sfondo bianco quando disponibile,
// altrimenti l'iniziale su sfondo colore-marchio (fallback onesto per Kayak).
function MetaBadge({ m }: { m: (typeof META)[number] }) {
  const path = META_ICON_PATHS[m.key];
  if (m.key === "google") {
    return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white"><GoogleMark /></span>;
  }
  if (path) {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white">
        <svg width="19" height="19" viewBox="0 0 24 24" fill={m.color}><path d={path} /></svg>
      </span>
    );
  }
  return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: m.color }}>{m.name[0]}</span>;
}
type MetaCfg = { on: boolean; model: "cpc" | "commission"; value: number };
const KEY = "spigolestay:metasearch:v2";
const COMM_KEY = "spigolestay:metasearch:avgcomm";
const DEST_KEY = "spigolestay:metasearch:dest";
const normalizeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

const defCfg = (k: string): MetaCfg => ({ on: k === "google", model: "cpc", value: k === "google" ? 0.35 : 0.3 });

export default function MetaSearchPage() {
  const { t } = useLang();
  const { roomTypes, structures, activeStructureId } = useData();
  const [localStructure, setLocalStructure] = useState("all");
  const effStructure = activeStructureId !== "all" ? activeStructureId : localStructure;
  const types = roomTypes.filter((rt) => effStructure === "all" || rt.structureId === effStructure);

  const [cfg, setCfg] = useState<Record<string, MetaCfg>>({});
  const [avgComm, setAvgComm] = useState(15);
  // Dove atterrano i click dai comparatori: il mini-sito Xenora (default) o il sito ufficiale
  // della struttura, SE ha il widget di prenotazione incorporato lì (pagina "Widget").
  const [dest, setDest] = useState<"xenora" | "official">("xenora");
  useEffect(() => {
    try {
      const r = localStorage.getItem(KEY); if (r) setCfg(JSON.parse(r));
      const c = localStorage.getItem(COMM_KEY); if (c) setAvgComm(JSON.parse(c));
      const d = localStorage.getItem(DEST_KEY); if (d === "official" || d === "xenora") setDest(d);
    } catch {}
  }, []);
  const saveDest = (v: "xenora" | "official") => { setDest(v); try { localStorage.setItem(DEST_KEY, v); } catch {} };
  const getCfg = (k: string): MetaCfg => cfg[k] ?? defCfg(k);
  const saveCfg = (next: Record<string, MetaCfg>) => { setCfg(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {} };
  const patch = (k: string, p: Partial<MetaCfg>) => saveCfg({ ...cfg, [k]: { ...getCfg(k), ...p } });
  const saveComm = (v: number) => { const n = Math.max(0, Math.min(40, v)); setAvgComm(n); try { localStorage.setItem(COMM_KEY, JSON.stringify(n)); } catch {} };

  // --- Collegamento REALE ai comparatori (feed prezzi + deep link) ----------
  // Il feed vive su /api/metasearch/feed/<slug>. Lo slug è quello con cui il sito
  // pubblico della struttura è online (tabella public_sites). Se non è pubblicato,
  // invitiamo a pubblicarlo dalla pagina "Sito web".
  const selStructure = structures.find((s) => s.id === effStructure);
  const [slug, setSlug] = useState<string | null>(null);
  const [slugState, setSlugState] = useState<"idle" | "loading" | "published" | "unpublished">("idle");
  const [fmt, setFmt] = useState<"json" | "xml">("json");
  const [copied, setCopied] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://xenora.it";

  useEffect(() => {
    setCopied("");
    if (effStructure === "all") { setSlug(null); setSlugState("idle"); return; }
    if (!supabase) { setSlug(selStructure ? slugify(selStructure.name) : null); setSlugState(selStructure ? "unpublished" : "idle"); return; }
    setSlugState("loading");
    let alive = true;
    Promise.resolve(supabase.from("public_sites").select("slug").eq("structure_id", effStructure).maybeSingle())
      .then(({ data }) => { if (!alive) return; if (data?.slug) { setSlug(data.slug as string); setSlugState("published"); } else { setSlug(selStructure ? slugify(selStructure.name) : null); setSlugState("unpublished"); } })
      .catch(() => { if (alive) { setSlug(selStructure ? slugify(selStructure.name) : null); setSlugState("unpublished"); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effStructure]);

  const feedBase = slug ? `${origin}/api/metasearch/feed/${slug}` : "";
  const feedUrl = feedBase ? feedBase + (fmt === "xml" ? "?format=xml" : "") : "";
  const officialWebsite = selStructure?.website?.trim() || "";
  const landingUrl = !slug ? "" : dest === "official" && officialWebsite ? normalizeUrl(officialWebsite) : `${origin}/prenota?site=${slug}`;
  const copy = (id: string, text: string) => { try { navigator.clipboard?.writeText(text); setCopied(id); window.setTimeout(() => setCopied((c) => (c === id ? "" : c)), 1600); } catch {} };

  const connected = META.filter((m) => getCfg(m.key).on).length;
  // Guadagno extra medio a notte = prezzo diretto × commissione OTA risparmiata.
  const avgExtra = types.length ? Math.round(types.reduce((a, rt) => a + effectiveBase(rt, roomTypes) * avgComm / 100, 0) / types.length) : 0;

  // Booking engine attivo? (prerequisito: i metasearch puntano al tuo sito/widget)
  const bookingReady = structures.some((s) => (effStructure === "all" || s.id === effStructure));

  const googleOn = getCfg("google").on;
  const trivagoOn = getCfg("trivago").on;

  return (
    <div>
      <PageHeader
        title="Meta Search"
        subtitle={t("Porta le tue tariffe dirette sui comparatori: l'ospite prenota da te, senza commissione OTA")}
        actions={activeStructureId === "all" ? (
          <select value={localStructure} onChange={(e) => setLocalStructure(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus">
            <option value="all">{t("Tutte le strutture")}</option>
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : null}
      />

      {/* Differenza dai Canali, in una riga */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-dim shadow-sm">
        <span>🆚</span>
        <span><b className="text-txt">{t("Canali")}</b> = {t("l'ospite prenota sull'OTA (con commissione).")}</span>
        <span className="text-faint">•</span>
        <span><b className="text-txt">Meta Search</b> = {t("l'ospite vede il tuo prezzo e prenota sul TUO sito (zero commissione OTA).")}</span>
      </div>

      {/* STEP 1 — dove atterra chi prenota diretto */}
      <SectionTitle>1. {t("Dove prenota chi arriva dai comparatori")}</SectionTitle>
      <Card className="mb-5 mt-2">
        <div className="flex flex-wrap items-start gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: bookingReady ? "var(--ok)" : "var(--warn)" }}>{bookingReady ? "✓" : "!"}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-txt">{t("Due modi, scegli quello che preferisci")}</div>
            <p className="mt-1 text-xs text-dim">
              <b className="text-txt">{t("Mini-sito Xenora")}</b> — {t("pubblicalo una volta in \"Sito web\", è sempre pronto, nessuna configurazione extra.")}<br />
              <b className="text-txt">{t("Il tuo sito ufficiale")}</b> — {t("se ne hai uno, incorpora il widget di prenotazione (pagina \"Widget\") e l'ospite resta sul tuo dominio.")}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link href="/sito" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{t("Sito web")}</Link>
            <Link href="/widget" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{t("Widget")}</Link>
          </div>
        </div>
      </Card>

      {/* STEP 2 — quali comparatori usare */}
      <SectionTitle>2. {t("Scegli i comparatori")}</SectionTitle>
      <p className="mb-2 mt-1 text-xs text-dim">{t("Attiva quelli che vuoi usare e imposta il modello di costo — è la tua configurazione, salvata qui. Il collegamento vero avviene al passo 3, dandogli il feed.")}</p>
      <Card className="mb-5 mt-2">
        <div className="flex flex-col divide-y divide-[color:var(--line)]">
          {META.map((m) => {
            const c = getCfg(m.key);
            return (
              <div key={m.key} className="flex flex-wrap items-center gap-3 py-3">
                <MetaBadge m={m} />
                <div className="min-w-[160px] flex-1">
                  <div className="text-sm font-semibold text-txt">{m.name}</div>
                  <div className="mt-0.5 text-xs text-dim">{t(m.desc)}</div>
                </div>
                {c.on && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <select value={c.model} onChange={(e) => patch(m.key, { model: e.target.value as "cpc" | "commission" })} className="rounded-lg border border-line bg-paper px-2 py-1 text-xs text-dim outline-none focus:border-focus">
                      <option value="cpc">{t("Costo per clic")}</option>
                      <option value="commission">{t("Commissione")}</option>
                    </select>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-wash px-2 py-1 text-dim">{c.model === "cpc" ? "€" : ""}<input type="number" step={c.model === "cpc" ? 0.05 : 1} min={0} value={c.value} onChange={(e) => patch(m.key, { value: Number(e.target.value) })} className="w-14 bg-transparent text-center font-semibold text-txt outline-none" />{c.model === "cpc" ? `/${t("clic")}` : "%"}</span>
                  </div>
                )}
                <button onClick={() => patch(m.key, { on: !c.on })} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${c.on ? "text-white" : "border border-line text-dim hover:bg-wash"}`} style={c.on ? { backgroundColor: "var(--ok)" } : undefined}>{c.on ? t("Collegato") : t("Collega")}</button>
              </div>
            );
          })}
        </div>
      </Card>

      {/* STEP 3 — collegare il feed reale */}
      <SectionTitle>3. {t("Collega il feed")}</SectionTitle>
      <Card className="mb-5 mt-2 !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-wash px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ backgroundColor: "var(--ok)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-txt">{t("Dai questo indirizzo al comparatore")}</h2>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: "var(--ok)" }}>{t("reale")}</span>
            </div>
            <p className="text-xs text-dim">{t("Nessuna loro API key: gli dai questo indirizzo e leggono da soli prezzi e disponibilità.")}</p>
          </div>
        </div>

        <div className="p-4">
          {effStructure === "all" ? (
            <div className="rounded-lg border border-line bg-wash px-3 py-3 text-sm text-dim">
              {t("Seleziona una struttura in alto: il feed è specifico per ogni struttura.")}
            </div>
          ) : slugState === "loading" ? (
            <div className="rounded-lg border border-line bg-wash px-3 py-3 text-sm text-faint">{t("Controllo dello stato di pubblicazione…")}</div>
          ) : slugState !== "published" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-wash px-3 py-3">
              <span className="grid h-7 w-7 place-items-center rounded-lg text-white" style={{ backgroundColor: "var(--warn)" }}>!</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-txt">{t("Prima completa il passo 1")}</div>
                <div className="text-xs text-dim">{t("Il feed usa i dati pubblici del tuo sito. Pubblicalo una volta, poi torna qui: l'indirizzo del feed sarà attivo.")}</div>
              </div>
              <Link href="/sito" className="shrink-0 rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">{t("Pubblica il sito")} →</Link>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Feed URL */}
              <div>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-txt">{t("URL del feed prezzi/disponibilità")}</span>
                  <div className="flex overflow-hidden rounded-lg border border-line text-[11px] font-semibold">
                    {(["json", "xml"] as const).map((f) => (
                      <button key={f} onClick={() => setFmt(f)} className={`px-2.5 py-1 transition ${fmt === f ? "bg-focus text-white" : "bg-paper text-dim hover:bg-wash"}`}>{f.toUpperCase()}</button>
                    ))}
                  </div>
                  <span className="text-[11px] text-faint">{t("prossimi 90 giorni")}</span>
                </div>
                <div className="flex flex-wrap items-stretch gap-2">
                  <div className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-lg border border-line bg-wash px-3 py-2 font-mono text-xs text-txt">{feedUrl}</div>
                  <button onClick={() => copy("feed", feedUrl)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">{copied === "feed" ? <span style={{ color: "var(--ok)" }}>✓ {t("Copiato")}</span> : t("Copia")}</button>
                  <a href={feedUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">{t("Apri")} ↗</a>
                </div>
              </div>

              {/* Destinazione dei click — collegata alla scelta del passo 1 */}
              <div>
                <div className="mb-1.5 text-xs font-semibold text-txt">{t("Destinazione (dal passo 1)")}</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => saveDest("xenora")} className={`rounded-lg border px-3 py-2 text-left text-xs transition ${dest === "xenora" ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_10%,var(--surface))]" : "border-line bg-surface hover:bg-wash"}`}>
                    <div className={`font-semibold ${dest === "xenora" ? "text-focus" : "text-txt"}`}>{t("Mini-sito Xenora")}</div>
                  </button>
                  <button onClick={() => officialWebsite && saveDest("official")} disabled={!officialWebsite} title={officialWebsite ? undefined : t("Salva prima un sito web in Strutture")} className={`rounded-lg border px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${dest === "official" ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_10%,var(--surface))]" : "border-line bg-surface hover:bg-wash"}`}>
                    <div className={`font-semibold ${dest === "official" ? "text-focus" : "text-txt"}`}>{t("Il tuo sito ufficiale")}</div>
                  </button>
                </div>
              </div>

              {/* Landing URL */}
              <div>
                <div className="mb-1.5 text-xs font-semibold text-txt">{t("URL di atterraggio (deep link al booking engine)")}</div>
                <div className="flex flex-wrap items-stretch gap-2">
                  <div className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-lg border border-line bg-wash px-3 py-2 font-mono text-xs text-txt">{landingUrl}</div>
                  <button onClick={() => copy("land", landingUrl)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">{copied === "land" ? <span style={{ color: "var(--ok)" }}>✓ {t("Copiato")}</span> : t("Copia")}</button>
                </div>
                <p className="mt-1 text-[11px] text-faint">{t("Ogni riga del feed include già il deep link con data e tipologia: l'ospite arriva sulla camera giusta con le date preselezionate.")}</p>
              </div>

              {/* Istruzioni passo-passo — solo per i comparatori attivati al passo 2 */}
              {!googleOn && !trivagoOn ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-faint">{t("Attiva Google Hotel Ads o Trivago al passo 2 per vedere qui le istruzioni di collegamento.")}</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {googleOn && (
                    <div className="rounded-lg border border-line p-3">
                      <div className="mb-1.5 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: "#4285F4" }}>G</span><span className="text-sm font-semibold text-txt">Google Hotel Center</span></div>
                      <ol className="list-decimal space-y-1 pl-4 text-xs text-dim">
                        <li>{t("Vai su hotelcenter.google.com e crea/collega il tuo account struttura.")}</li>
                        <li>{t("Attiva i \"Free Booking Links\" (link di prenotazione gratuiti).")}</li>
                        <li>{t("Nella sezione Feed / Prezzi, indica questo URL come sorgente prezzi e disponibilità.")}</li>
                        <li>{t("Imposta l'URL di atterraggio (Point of Sale) sul dominio del booking engine qui sopra.")}</li>
                        <li>{t("Verifica la corrispondenza dei prezzi e pubblica.")}</li>
                      </ol>
                    </div>
                  )}
                  {trivagoOn && (
                    <div className="rounded-lg border border-line p-3">
                      <div className="mb-1.5 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: "#E32851" }}>t</span><span className="text-sm font-semibold text-txt">Trivago</span></div>
                      <ol className="list-decimal space-y-1 pl-4 text-xs text-dim">
                        <li>{t("Registra la struttura su Trivago Business Studio.")}</li>
                        <li>{t("Richiedi l'attivazione del tasso diretto (Rate Connect) o dei link gratuiti.")}</li>
                        <li>{t("Fornisci al referente/connettore questo URL del feed come sorgente prezzi.")}</li>
                        <li>{t("Indica l'URL di atterraggio del booking engine come sito ufficiale.")}</li>
                        <li>{t("Attendi la validazione e attiva.")}</li>
                      </ol>
                    </div>
                  )}
                </div>
              )}
              <p className="text-[11px] text-faint">{t("Nota: alcuni comparatori richiedono un formato di feed specifico o un connettore certificato. Questo feed (JSON/XML) copre i casi \"Free Booking Links\" e le integrazioni via foglio/connettore; per gli standard proprietari serve un mapping dedicato.")}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Quanto guadagni vendendo diretto */}
      <SectionTitle>{t("Quanto guadagni vendendo diretto")}</SectionTitle>
      <div className="mb-3 mt-2 grid gap-3 sm:grid-cols-3">
        <StatCard label={t("Comparatori collegati")} value={<>{connected}<span className="text-sm font-normal text-faint">/{META.length}</span></>} />
        <Card className="!p-4">
          <div className="text-xs text-dim">{t("Commissione media OTA")}</div>
          <div className="mt-1 flex items-center gap-1"><input type="number" min={0} max={40} value={avgComm} onChange={(e) => saveComm(Number(e.target.value))} className="w-16 rounded-lg border border-line bg-surface px-2 py-1 font-mono text-lg font-bold text-txt outline-none focus:border-focus" /><span className="text-dim">%</span></div>
          <div className="mt-0.5 text-[11px] text-faint">{t("quanto risparmi vendendo diretto")}</div>
        </Card>
        <StatCard label={t("Guadagno extra medio")} value={eur(avgExtra)} color="var(--ok)" hint={t("a notte, per prenotazione diretta")} />
      </div>
      {types.length === 0 ? (
        <Card><div className="py-6 text-center text-sm text-faint">{t("Nessuna tipologia per questa struttura.")}</div></Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-3 py-2 font-semibold">{t("Tipologia")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Prezzo")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Incassi via OTA")} (−{avgComm}%)</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Incassi diretto")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Extra a notte")}</th>
              </tr>
            </thead>
            <tbody>
              {types.map((rt) => {
                const price = effectiveBase(rt, roomTypes);
                const otaNet = Math.round(price * (1 - avgComm / 100));
                const extra = price - otaNet;
                return (
                  <tr key={rt.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 font-medium text-txt">{rt.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-dim">{eur(price)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-dim">{eur(otaNet)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(price)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: "var(--ok)" }}>+{eur(extra)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-faint">{t("I metasearch mostrano il prezzo del tuo Booking Engine accanto a quello delle OTA. Se il diretto è competitivo, l'ospite prenota da te e tu trattieni la commissione. Il feed prezzi qui sopra è reale: questa tabella e la commissione media sono invece dimostrative, per stimare il guadagno.")}</p>
    </div>
  );
}
