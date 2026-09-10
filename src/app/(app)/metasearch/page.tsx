"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { effectiveBase } from "@/lib/pricing";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";

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

      {/* Differenza dai Canali, in una riga */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-dim shadow-sm">
        <span>🆚</span>
        <span><b className="text-txt">{t("Canali")}</b> = {t("l'ospite prenota sull'OTA (con commissione).")}</span>
        <span className="text-faint">•</span>
        <span><b className="text-txt">Meta Search</b> = {t("l'ospite vede il tuo prezzo e prenota sul TUO sito (zero commissione OTA).")}</span>
      </div>

      {/* KPI */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="!p-4"><div className="text-xs text-dim">{t("Comparatori collegati")}</div><div className="mt-1 font-mono text-2xl font-bold text-txt">{connected}<span className="text-sm font-normal text-faint">/{META.length}</span></div></Card>
        <Card className="!p-4">
          <div className="text-xs text-dim">{t("Commissione media OTA")}</div>
          <div className="mt-1 flex items-center gap-1"><input type="number" min={0} max={40} value={avgComm} onChange={(e) => saveComm(Number(e.target.value))} className="w-16 rounded-lg border border-line bg-surface px-2 py-1 font-mono text-lg font-bold text-txt outline-none focus:border-focus" /><span className="text-dim">%</span></div>
          <div className="mt-0.5 text-[11px] text-faint">{t("quanto risparmi vendendo diretto")}</div>
        </Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Guadagno extra medio")}</div><div className="mt-1 font-mono text-2xl font-bold" style={{ color: "var(--ok)" }}>{eur(avgExtra)}</div><div className="mt-0.5 text-[11px] text-faint">{t("a notte, per prenotazione diretta")}</div></Card>
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
      <p className="mt-3 text-xs text-faint">{t("I metasearch mostrano il prezzo del tuo Booking Engine accanto a quello delle OTA. Se il diretto è competitivo, l'ospite prenota da te e tu trattieni la commissione. In produzione la connessione è reale; qui i dati sono dimostrativi e salvati nel browser.")}</p>
    </div>
  );
}
