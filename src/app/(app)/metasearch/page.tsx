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
  { key: "tripadvisor", name: "Tripadvisor", desc: "Recensioni + confronto prezzi diretti.", color: "#00AA6C" },
  { key: "trip", name: "Trip.com", desc: "Copertura sul mercato asiatico.", color: "#2577E3" },
  { key: "kayak", name: "Kayak", desc: "Aggregatore viaggi USA/EU.", color: "#FF690F" },
];
type MetaCfg = { on: boolean; model: "cpc" | "commission"; value: number };
const KEY = "spigolestay:metasearch:v2";
const COMM_KEY = "spigolestay:metasearch:avgcomm";

const defCfg = (k: string): MetaCfg => ({ on: k === "google", model: "cpc", value: k === "google" ? 0.35 : 0.3 });

export default function MetaSearchPage() {
  const { t } = useLang();
  const { roomTypes, structures, activeStructureId } = useData();
  const [localStructure, setLocalStructure] = useState("all");
  const effStructure = activeStructureId !== "all" ? activeStructureId : localStructure;
  const types = roomTypes.filter((rt) => effStructure === "all" || rt.structureId === effStructure);

  const [cfg, setCfg] = useState<Record<string, MetaCfg>>({});
  const [avgComm, setAvgComm] = useState(15);
  useEffect(() => {
    try { const r = localStorage.getItem(KEY); if (r) setCfg(JSON.parse(r)); const c = localStorage.getItem(COMM_KEY); if (c) setAvgComm(JSON.parse(c)); } catch {}
  }, []);
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
  const landingUrl = slug ? `${origin}/prenota?site=${slug}` : "";
  const copy = (id: string, text: string) => { try { navigator.clipboard?.writeText(text); setCopied(id); window.setTimeout(() => setCopied((c) => (c === id ? "" : c)), 1600); } catch {} };

  const connected = META.filter((m) => getCfg(m.key).on).length;
  // Guadagno extra medio a notte = prezzo diretto × commissione OTA risparmiata.
  const avgExtra = types.length ? Math.round(types.reduce((a, rt) => a + effectiveBase(rt, roomTypes) * avgComm / 100, 0) / types.length) : 0;

  // Booking engine attivo? (prerequisito: i metasearch puntano al tuo sito/widget)
  const bookingReady = structures.some((s) => (effStructure === "all" || s.id === effStructure));

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

      {/* Collega ai comparatori (REALE): feed prezzi + deep link */}
      <Card className="mb-5 !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-wash px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ backgroundColor: "var(--ok)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-txt">{t("Collega ai comparatori")}</h2>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: "var(--ok)" }}>{t("reale")}</span>
            </div>
            <p className="text-xs text-dim">{t("Il tuo feed prezzi e disponibilità è pubblicato e leggibile dai comparatori. Nessuna loro API key: gli dai questo indirizzo e leggono da soli.")}</p>
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
                <div className="text-sm font-semibold text-txt">{t("Prima pubblica il sito della struttura")}</div>
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
              {/* Landing URL */}
              <div>
                <div className="mb-1.5 text-xs font-semibold text-txt">{t("URL di atterraggio (deep link al booking engine)")}</div>
                <div className="flex flex-wrap items-stretch gap-2">
                  <div className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-lg border border-line bg-wash px-3 py-2 font-mono text-xs text-txt">{landingUrl}</div>
                  <button onClick={() => copy("land", landingUrl)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">{copied === "land" ? <span style={{ color: "var(--ok)" }}>✓ {t("Copiato")}</span> : t("Copia")}</button>
                </div>
                <p className="mt-1 text-[11px] text-faint">{t("Ogni riga del feed include già il deep link con data e tipologia: l'ospite arriva sulla camera giusta con le date preselezionate.")}</p>
              </div>

              {/* Istruzioni passo-passo */}
              <div className="grid gap-3 sm:grid-cols-2">
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
              </div>
              <p className="text-[11px] text-faint">{t("Nota: alcuni comparatori richiedono un formato di feed specifico o un connettore certificato. Questo feed (JSON/XML) copre i casi \"Free Booking Links\" e le integrazioni via foglio/connettore; per gli standard proprietari serve un mapping dedicato.")}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Differenza dai Canali, in una riga */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-dim shadow-sm">
        <span>🆚</span>
        <span><b className="text-txt">{t("Canali")}</b> = {t("l'ospite prenota sull'OTA (con commissione).")}</span>
        <span className="text-faint">•</span>
        <span><b className="text-txt">Meta Search</b> = {t("l'ospite vede il tuo prezzo e prenota sul TUO sito (zero commissione OTA).")}</span>
      </div>

      {/* KPI */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label={t("Comparatori collegati")} value={<>{connected}<span className="text-sm font-normal text-faint">/{META.length}</span></>} />
        <Card className="!p-4">
          <div className="text-xs text-dim">{t("Commissione media OTA")}</div>
          <div className="mt-1 flex items-center gap-1"><input type="number" min={0} max={40} value={avgComm} onChange={(e) => saveComm(Number(e.target.value))} className="w-16 rounded-lg border border-line bg-surface px-2 py-1 font-mono text-lg font-bold text-txt outline-none focus:border-focus" /><span className="text-dim">%</span></div>
          <div className="mt-0.5 text-[11px] text-faint">{t("quanto risparmi vendendo diretto")}</div>
        </Card>
        <StatCard label={t("Guadagno extra medio")} value={eur(avgExtra)} color="var(--ok)" hint={t("a notte, per prenotazione diretta")} />
      </div>

      {/* Prerequisito: booking engine */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ backgroundColor: bookingReady ? "var(--ok)" : "var(--warn)" }}>{bookingReady ? "✓" : "!"}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-txt">{t("Booking engine diretto")}</div>
            <div className="text-xs text-dim">{t("I metasearch mandano l'ospite qui per prenotare. Serve il tuo motore di prenotazione attivo.")}</div>
          </div>
          <div className="flex gap-2">
            <Link href="/sito" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{t("Sito web")}</Link>
            <Link href="/widget" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{t("Widget")}</Link>
          </div>
        </div>
      </Card>

      {/* Comparatori */}
      <SectionTitle>{t("Comparatori")}</SectionTitle>
      <p className="mb-2 mt-1 text-xs text-dim">{t("Attiva/disattiva e imposta il modello di costo di ogni comparatore. Questa è la tua configurazione (salvata nel browser); il collegamento vero avviene fornendo il feed reale qui sopra.")}</p>
      <Card className="mb-5 mt-2">
        <div className="flex flex-col divide-y divide-[color:var(--line)]">
          {META.map((m) => {
            const c = getCfg(m.key);
            return (
              <div key={m.key} className="flex flex-wrap items-center gap-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: m.color }}>{m.name[0]}</span>
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

      {/* Confronto: diretto vs OTA */}
      <SectionTitle>{t("Diretto vs OTA — quanto incassi")}</SectionTitle>
      <p className="mb-2 mt-1 text-xs text-dim">{t("Stesso prezzo per l'ospite, ma sul diretto non paghi la commissione. Ecco quanto trattieni in più a notte.")}</p>
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
