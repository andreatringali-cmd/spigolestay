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

const VAT = 0.22; // IVA 22%

interface Invoice { date: Date; number: string; description: string; net: number; tax: number; amount: number; paidOn: Date | null }

export default function FatturePage() {
  const { t } = useLang();
  const [tier, setTier] = useState<string>("basic");
  useEffect(() => { try { setTier(localStorage.getItem("spigolestay:plan") || localStorage.getItem("spigolestay:tier") || "basic"); } catch {} }, []);
  const plan = TIER_PRICE[tier] ?? TIER_PRICE.basic;

  const fmtMonth = (d: Date) => d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const fmtDay = (d: Date | null) => (d ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

  // Ultime 6 mensilità (dimostrative): la più recente "da incassare", le precedenti incassate.
  const invoices = useMemo<Invoice[]>(() => {
    const now = new Date();
    const months: Date[] = [];
    for (let i = 5; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    const perYear: Record<number, number> = {};
    const rows = months.map((d) => {
      const y = d.getFullYear();
      perYear[y] = (perYear[y] ?? 0) + 1;
      const amount = plan.price;
      const net = Math.round((amount / (1 + VAT)) * 100) / 100;
      const tax = Math.round((amount - net) * 100) / 100;
      const isCurrent = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      return {
        date: d,
        number: `${String(perYear[y]).padStart(4, "0")}/${y}`,
        description: `${t("Abbonamento Xenora")} ${plan.name} · ${fmtMonth(d)}`,
        net, tax, amount,
        paidOn: isCurrent ? null : new Date(d.getFullYear(), d.getMonth(), 3),
      } as Invoice;
    });
    return rows.reverse(); // più recente in alto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const tot = invoices.reduce((a, iv) => ({ net: a.net + iv.net, tax: a.tax + iv.tax, amount: a.amount + iv.amount }), { net: 0, tax: 0, amount: 0 });

  const stampa = () => {
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return;
    const esc = (s: string) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rows = invoices.map((iv) => `<tr>
      <td>${fmtDay(iv.date)}</td>
      <td class="mono">${esc(iv.number)}</td>
      <td>${esc(iv.description)}</td>
      <td class="r mono">${eur(iv.net)}</td>
      <td class="r mono">${eur(iv.tax)}</td>
      <td class="r mono"><b>${eur(iv.amount)}</b></td>
      <td>${iv.paidOn ? fmtDay(iv.paidOn) : "—"}</td>
    </tr>`).join("");
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Storico fatture · Xenora</title><style>
@page{size:A4 landscape;margin:14mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#1f2430;margin:0}
h1{font-size:18px;margin:0 0 2px}
.sub{color:#6b7280;font-size:12px;margin:0 0 16px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;text-transform:uppercase;letter-spacing:.04em;font-size:10px;color:#9aa1ac;border-bottom:2px solid #e6e8ec;padding:8px 6px}
td{padding:8px 6px;border-bottom:1px solid #f0ebe3}
.r{text-align:right}.mono{font-family:'Courier New',monospace}
tfoot td{border-top:2px solid #e6e8ec;font-weight:700}
</style></head><body>
<h1>Storico fatture — ${esc(plan.name)}</h1>
<p class="sub">Abbonamento Xenora · generato il ${new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}</p>
<table>
<thead><tr>
<th>Data fatturazione</th><th>Numero</th><th>Descrizione</th><th class="r">Prezzo netto</th><th class="r">Tasse</th><th class="r">Importo</th><th>Incassato il</th>
</tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="3">Totale</td><td class="r mono">${eur(tot.net)}</td><td class="r mono">${eur(tot.tax)}</td><td class="r mono">${eur(tot.amount)}</td><td></td></tr></tfoot>
</table>
</body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div>
      <PageHeader title={t("Fatture")} subtitle={t("Le fatture del tuo abbonamento Xenora")}
        actions={<button onClick={stampa} className="flex items-center gap-1.5 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6z" /></svg>
          {t("Stampa")}
        </button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Card className="!p-4"><div className="text-xs text-dim">{t("Piano attivo")}</div><div className="mt-0.5 text-lg font-bold text-txt">{plan.name}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Canone mensile")}</div><div className="mt-0.5 font-mono text-lg font-bold text-txt">{eur(plan.price)} <span className="text-[11px] font-normal text-faint">{t("IVA inclusa")}</span></div><div className="mt-0.5 text-[11px] text-faint">{t("Netto")} {eur(Math.round((plan.price / (1 + VAT)) * 100) / 100)} + {t("IVA")} 22% {eur(Math.round((plan.price - plan.price / (1 + VAT)) * 100) / 100)}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Prossimo rinnovo")}</div><div className="mt-0.5 text-lg font-bold text-txt">{fmtMonth(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1))}</div></Card>
      </div>

      <Card>
        <SectionTitle>{t("Storico fatture")}</SectionTitle>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-3 py-2 font-semibold">{t("Data fatturazione")}</th>
                <th className="px-3 py-2 font-semibold">{t("Numero")}</th>
                <th className="px-3 py-2 font-semibold">{t("Descrizione")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Prezzo netto")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Tasse")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Importo")}</th>
                <th className="px-3 py-2 font-semibold">{t("Incassato il")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((iv) => (
                <tr key={iv.number} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 text-txt">{fmtDay(iv.date)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-dim">{iv.number}</td>
                  <td className="px-3 py-2.5 capitalize text-txt">{iv.description}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-dim">{eur(iv.net)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-dim">{eur(iv.tax)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(iv.amount)}</td>
                  <td className="px-3 py-2.5">
                    {iv.paidOn
                      ? <span className="text-txt">{fmtDay(iv.paidOn)}</span>
                      : <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("Da incassare")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td className="px-3 py-2.5 text-txt" colSpan={3}>{t("Totale")}</td>
                <td className="px-3 py-2.5 text-right font-mono text-txt">{eur(tot.net)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-txt">{eur(tot.tax)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-txt">{eur(tot.amount)}</td>
                <td className="px-3 py-2.5"></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">{t("Elenco dimostrativo. In produzione le fatture sono emesse automaticamente a ogni rinnovo (Stripe + fattura elettronica) e scaricabili in PDF.")}</p>
      </Card>
    </div>
  );
}
