"use client";

// Fatture dell'abbonamento (dimostrativo). In produzione arrivano dal sistema di fatturazione
// (Stripe + fattura elettronica). Qui generiamo un elenco d'esempio in base al piano attivo.

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { eur } from "@/lib/format";
import { useLang } from "@/lib/i18n";

const TIER_PRICE: Record<string, { name: string; price: number }> = {
  basic: { name: "Basic", price: 29 },
  pro: { name: "Pro", price: 49 },
  ultimate: { name: "Ultimate", price: 89 },
};

export default function FatturePage() {
  const { t } = useLang();
  const [tier, setTier] = useState<string>("basic");
  useEffect(() => { try { setTier(localStorage.getItem("spigolestay:plan") || localStorage.getItem("spigolestay:tier") || "basic"); } catch {} }, []);
  const plan = TIER_PRICE[tier] ?? TIER_PRICE.basic;

  // Ultime 4 mensilità (dimostrative): la più recente "da pagare", le precedenti pagate.
  const invoices = useMemo(() => [] as { id: string; date: Date; amount: number; status: "paid" | "due" }[], []);

  const fmt = (d: Date) => d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader title={t("Fatture")} subtitle={t("Le fatture del tuo abbonamento Xenora")} />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Card className="!p-4"><div className="text-xs text-dim">{t("Piano attivo")}</div><div className="mt-0.5 text-lg font-bold text-txt">{plan.name}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Canone mensile")}</div><div className="mt-0.5 font-mono text-lg font-bold text-txt">{eur(plan.price)}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Prossimo rinnovo")}</div><div className="mt-0.5 text-lg font-bold text-txt">{fmt(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1))}</div></Card>
      </div>

      <Card>
        <SectionTitle>{t("Storico fatture")}</SectionTitle>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-3 py-2 font-semibold">{t("Periodo")}</th>
                <th className="px-3 py-2 font-semibold">{t("Numero")}</th>
                <th className="px-3 py-2 font-semibold">{t("Importo")}</th>
                <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
                <th className="px-3 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((iv) => (
                <tr key={iv.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 capitalize text-txt">{fmt(iv.date)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-dim">XEN-{iv.id}</td>
                  <td className="px-3 py-2.5 font-mono text-txt">{eur(iv.amount)}</td>
                  <td className="px-3 py-2.5">
                    {iv.status === "paid"
                      ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>{t("Pagata")}</span>
                      : <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("Da pagare")}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right"><span className="cursor-not-allowed text-xs font-medium text-faint" title={t("Disponibile alla messa in produzione")}>{t("Scarica PDF")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">{t("Elenco dimostrativo. In produzione le fatture sono emesse automaticamente a ogni rinnovo e scaricabili in PDF.")}</p>
      </Card>
    </div>
  );
}
