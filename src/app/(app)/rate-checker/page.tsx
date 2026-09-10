"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function RateCheckerPage() {
  const { roomTypes, rateOverrides, activeStructureId } = useData();
  const { t } = useLang();
  const [days] = useState(14);
  // Confronto competitor: si attiva collegando un servizio di rate shopping (fase white-label).
  const [connected, setConnected] = useState(false);

  const rts = roomTypes.filter((rt) => activeStructureId === "all" || rt.structureId === activeStructureId);
  const avgBase = rts.length ? Math.round(rts.reduce((a, rt) => a + rt.basePrice, 0) / rts.length) : 0;

  const rows = useMemo(() => {
    const start = todayISO();
    return Array.from({ length: days }, (_, i) => {
      const iso = addDays(start, i);
      const mine = rateOverrides[iso] ?? avgBase;
      return { iso, mine };
    });
  }, [rateOverrides, avgBase, days]);

  return (
    <div>
      <PageHeader title="Rate checker" subtitle={t("Confronta le tue tariffe con i competitor della zona")} />

      {/* Stato collegamento rate shopping */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: connected ? "var(--ok)" : "var(--warn)" }}>{connected ? "✓" : "!"}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-txt">{t("Confronto competitor")}</div>
            <div className="text-xs text-dim">{connected ? t("Servizio di rate shopping collegato.") : t("Non collegato. Il confronto con gli hotel simili si attiva con un servizio di rate shopping (Booking/Google) — in arrivo con il white-label.")}</div>
          </div>
          <button onClick={() => setConnected((v) => !v)} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${connected ? "border border-line text-dim hover:bg-wash" : "bg-focus text-white hover:opacity-90"}`}>{connected ? t("Scollega") : t("Collega")}</button>
        </div>
      </Card>

      <Card>
        <SectionTitle>{t("Le tue tariffe")} · {t("prossimi")} {days} {t("giorni")}</SectionTitle>
        {rts.length === 0 ? (
          <div className="py-8 text-center text-sm text-faint">{t("Nessuna tipologia: imposta i prezzi nelle Tariffe.")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">{t("Giorno")}</th>
                  <th className="px-2 py-2 font-semibold">{t("La tua tariffa")}</th>
                  <th className="px-2 py-2 font-semibold">{t("Media mercato")}</th>
                  <th className="px-2 py-2 font-semibold">{t("Posizione")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.iso} className="border-b border-line last:border-0">
                    <td className="px-2 py-2 font-medium text-txt">{new Date(r.iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" })}</td>
                    <td className="px-2 py-2 font-mono font-semibold text-txt">{eur(r.mine)}</td>
                    <td className="px-2 py-2 font-mono text-faint">{connected ? "—" : <span className="text-faint">—</span>}</td>
                    <td className="px-2 py-2"><span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-dim">{connected ? t("in linea") : t("collega per confrontare")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-faint">{t("La colonna 'La tua tariffa' usa i prezzi reali dal Calendario/Tariffe. Il confronto con i competitor si popola quando colleghi un servizio di rate shopping.")}</p>
      </Card>
    </div>
  );
}
