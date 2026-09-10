"use client";

// Registro attività: storico delle azioni sul gestionale (data/ora, evento, descrizione, utente).

import { useMemo, useState } from "react";
import { useData, type ActivityType } from "@/lib/store";
import { PageHeader, Card } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const META: Record<ActivityType, { label: string; color: string }> = {
  booking: { label: "Prenotazione", color: "#2F9E6F" },
  cancel: { label: "Cancellazione", color: "#D64545" },
  block: { label: "Fuori servizio", color: "#8A93A6" },
  move: { label: "Spostamento", color: "#5E7C8B" },
  event: { label: "Evento", color: "#7C4DD6" },
  rate: { label: "Tariffe", color: "#C08A3A" },
  quote: { label: "Preventivo", color: "#2C8A8A" },
  payment: { label: "Pagamento", color: "#4F46E5" },
  login: { label: "Accesso", color: "#957A66" },
  message: { label: "Messaggio", color: "#25A0A0" },
  config: { label: "Configurazione", color: "#5E7C8B" },
};

export default function RegistroPage() {
  const { activities } = useData();
  const { t } = useLang();
  const [type, setType] = useState<string>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return activities.filter((a) => (type === "all" || a.type === type) && (!ql || a.text.toLowerCase().includes(ql) || (a.by ?? "").toLowerCase().includes(ql)));
  }, [activities, type, q]);

  const fmt = (ts: number) => new Date(ts).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <PageHeader title={t("Registro attività")} subtitle={t("Storico delle azioni: prenotazioni, messaggi, accessi, tariffe e altro")} />

      {/* Riga filtri */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cerca…")} className="w-48 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-txt outline-none focus:border-focus" />
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-txt outline-none focus:border-focus">
          <option value="all">{t("Tutti gli eventi")}</option>
          {(Object.keys(META) as ActivityType[]).map((k) => <option key={k} value={k}>{t(META[k].label)}</option>)}
        </select>
        {(q || type !== "all") && <button onClick={() => { setQ(""); setType("all"); }} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-dim hover:bg-wash">✕ {t("Azzera")}</button>}
        <span className="ml-auto text-xs text-faint">{rows.length} {rows.length === 1 ? t("evento") : t("eventi")}</span>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-3 py-2 font-semibold">{t("Data e ora")}</th>
                <th className="px-3 py-2 font-semibold">{t("Evento")}</th>
                <th className="px-3 py-2 font-semibold">{t("Descrizione")}</th>
                <th className="px-3 py-2 font-semibold">{t("Utente")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-faint">{t("Nessuna attività registrata.")}</td></tr>}
              {rows.map((a) => {
                const m = META[a.type] ?? { label: a.type, color: "var(--faint)" };
                return (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-dim">{fmt(a.ts)}</td>
                    <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${m.color} 16%, transparent)`, color: m.color }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.color }} />{t(m.label)}</span></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-txt">{a.text}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-dim">{a.by || <span className="text-faint">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">{t("Vengono registrate automaticamente: nuove prenotazioni, cancellazioni, spostamenti, fuori servizio, cambi tariffa, messaggi inviati e accessi. Ultimi 500 eventi.")}</p>
      </Card>
    </div>
  );
}
