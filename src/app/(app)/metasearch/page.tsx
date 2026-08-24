"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const META = [
  { key: "google", name: "Google Hotel Ads", desc: "Comparatore n°1: appare nella scheda Google e Maps.", color: "#4285F4" },
  { key: "trivago", name: "Trivago", desc: "Metasearch europeo, forte sul mercato DACH.", color: "#E32851" },
  { key: "tripadvisor", name: "Tripadvisor", desc: "Recensioni + confronto prezzi diretti.", color: "#00AA6C" },
  { key: "trip", name: "Trip.com", desc: "Copertura sul mercato asiatico.", color: "#2577E3" },
  { key: "kayak", name: "Kayak", desc: "Aggregatore viaggi USA/EU.", color: "#FF690F" },
];
const KEY = "spigolestay:metasearch";

export default function MetaSearchPage() {
  const { t } = useLang();
  const [on, setOn] = useState<Record<string, boolean>>({ google: true });
  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setOn(JSON.parse(r)); } catch {} }, []);
  const toggle = (k: string) => setOn((p) => { const n = { ...p, [k]: !p[k] }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; });
  const connected = META.filter((m) => on[m.key]).length;

  return (
    <div>
      <PageHeader title="Meta Search" subtitle={t("Porta le tue tariffe dirette sui principali comparatori")} />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="!p-4"><div className="text-xs text-dim">{t("Comparatori collegati")}</div><div className="mt-1 font-mono text-2xl font-bold text-txt">{connected}/{META.length}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Modello")}</div><div className="mt-1 text-sm font-semibold text-txt">{t("Costo per clic / commissione")}</div><div className="mt-0.5 text-[11px] text-faint">{t("solo su prenotazioni dirette")}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Fonte tariffe")}</div><div className="mt-1 text-sm font-semibold text-txt">{t("Booking Engine diretto")}</div><div className="mt-0.5 text-[11px] text-faint">{t("zero commissioni OTA")}</div></Card>
      </div>

      <Card>
        <SectionTitle>{t("Comparatori")}</SectionTitle>
        <div className="flex flex-col divide-y divide-[color:var(--line)]">
          {META.map((m) => {
            const active = !!on[m.key];
            return (
              <div key={m.key} className="flex items-center gap-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: m.color }}>{m.name[0]}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-txt">{m.name}</div>
                  <div className="mt-0.5 text-xs text-dim">{t(m.desc)}</div>
                </div>
                <button onClick={() => toggle(m.key)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${active ? "text-white" : "border border-line text-dim hover:bg-wash"}`} style={active ? { backgroundColor: "var(--ok)" } : undefined}>{active ? t("Collegato") : t("Collega")}</button>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-faint">{t("I metasearch mostrano il prezzo diretto del tuo")} <Link href="/sito" className="font-medium text-focus hover:underline">{t("Sito web")}</Link> {t("accanto a quello delle OTA: l'ospite prenota da te, senza commissioni di intermediazione.")}</p>
      </Card>
    </div>
  );
}
