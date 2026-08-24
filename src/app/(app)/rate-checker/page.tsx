"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

// Competitor fittizi (in produzione arriverebbero da un servizio di rate shopping).
const COMPETITORS = [
  { name: "B&B Ortigia Charme", delta: 12 },
  { name: "Casa Aretusa", delta: -8 },
  { name: "Dimora del Duomo", delta: 22 },
  { name: "Rooms Marina", delta: -3 },
];
// Variazione pseudo-casuale ma stabile per giorno (niente Math.random per coerenza).
const jitter = (iso: string, seed: number) => { let h = seed; for (const ch of iso) h = (h * 31 + ch.charCodeAt(0)) % 97; return (h % 21) - 10; };

export default function RateCheckerPage() {
  const { roomTypes, rateOverrides, activeStructureId } = useData();
  const { t } = useLang();
  const [days] = useState(14);

  const rts = roomTypes.filter((rt) => activeStructureId === "all" || rt.structureId === activeStructureId);
  const avgBase = rts.length ? Math.round(rts.reduce((a, rt) => a + rt.basePrice, 0) / rts.length) : 80;

  const rows = useMemo(() => {
    const start = todayISO();
    return Array.from({ length: days }, (_, i) => {
      const iso = addDays(start, i);
      const mine = rateOverrides[iso] ?? avgBase;
      const comps = COMPETITORS.map((c) => ({ name: c.name, price: Math.max(30, mine + c.delta + jitter(iso, c.name.length)) }));
      const market = Math.round(comps.reduce((a, c) => a + c.price, 0) / comps.length);
      return { iso, mine, comps, market, min: Math.min(...comps.map((c) => c.price)), max: Math.max(...comps.map((c) => c.price)) };
    });
  }, [rateOverrides, avgBase, days]);

  const belowMarket = rows.filter((r) => r.mine < r.market).length;

  return (
    <div>
      <PageHeader title="Rate checker" subtitle={t("Confronto delle tue tariffe con i competitor della zona")} />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="!p-4"><div className="text-xs text-dim">{t("Competitor monitorati")}</div><div className="mt-1 font-mono text-2xl font-bold text-txt">{COMPETITORS.length}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Giorni sotto la media di mercato")}</div><div className="mt-1 font-mono text-2xl font-bold" style={{ color: belowMarket > days / 2 ? "var(--err)" : "var(--txt)" }}>{belowMarket}/{days}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Posizionamento medio")}</div><div className="mt-1 font-mono text-2xl font-bold text-txt">{Math.round(rows.reduce((a, r) => a + (r.mine - r.market), 0) / rows.length)} €</div><div className="mt-0.5 text-[11px] text-faint">{t("vs media competitor")}</div></Card>
      </div>

      <Card>
        <SectionTitle>{t("Prossimi")} {days} {t("giorni")}</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-2 py-2 font-semibold">{t("Giorno")}</th>
                <th className="px-2 py-2 font-semibold">{t("La tua tariffa")}</th>
                <th className="px-2 py-2 font-semibold">{t("Fascia competitor")}</th>
                <th className="px-2 py-2 font-semibold">{t("Media mercato")}</th>
                <th className="px-2 py-2 font-semibold">{t("Posizione")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.mine - r.market;
                const span = r.max - r.min || 1;
                const pos = ((r.mine - r.min) / span) * 100;
                return (
                  <tr key={r.iso} className="border-b border-line last:border-0">
                    <td className="px-2 py-2 font-medium text-txt">{new Date(r.iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" })}</td>
                    <td className="px-2 py-2 font-mono font-semibold text-txt">{eur(r.mine)}</td>
                    <td className="px-2 py-2">
                      <div className="relative h-1.5 w-28 rounded-full bg-wash">
                        <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded" style={{ left: `${Math.max(0, Math.min(100, pos))}%`, backgroundColor: "var(--focus)" }} />
                      </div>
                      <span className="mt-0.5 block font-mono text-[10px] text-faint">{eur(r.min)} – {eur(r.max)}</span>
                    </td>
                    <td className="px-2 py-2 font-mono text-dim">{eur(r.market)}</td>
                    <td className="px-2 py-2">
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={diff < -5 ? { backgroundColor: "color-mix(in srgb, var(--err) 15%, transparent)", color: "var(--err)" } : diff > 5 ? { backgroundColor: "color-mix(in srgb, var(--ok) 15%, transparent)", color: "var(--ok)" } : { backgroundColor: "var(--wash)", color: "var(--dim)" }}>
                        {diff < -5 ? t("sotto mercato") : diff > 5 ? t("sopra mercato") : t("in linea")} {diff !== 0 ? `${diff > 0 ? "+" : ""}${diff}€` : ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">{t("Dati competitor dimostrativi. In produzione il rate checker interroga un servizio di rate shopping (Booking, Google) per confrontare in tempo reale i prezzi degli hotel simili nella tua zona.")}</p>
      </Card>
    </div>
  );
}
