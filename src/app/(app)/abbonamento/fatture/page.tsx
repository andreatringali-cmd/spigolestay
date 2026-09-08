"use client";

// Fatture dell'abbonamento (dimostrativo). In produzione arrivano dal sistema di fatturazione
// (Stripe + fattura elettronica). Qui generiamo un elenco d'esempio in base al piano attivo.

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { eur } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { readSubscription, type SubSummary } from "@/lib/plans";

const VAT = 0.22; // IVA 22%

interface Invoice { date: Date; due: Date; number: string; description: string; net: number; tax: number; amount: number; method: string; paidOn: Date | null }
type InvStatus = "paid" | "due" | "overdue";
const statusOf = (iv: Invoice): InvStatus => (iv.paidOn ? "paid" : (iv.due.getTime() < Date.now() ? "overdue" : "due"));

export default function FatturePage() {
  const { t } = useLang();
  const [sub, setSub] = useState<SubSummary | null>(null);
  useEffect(() => { setSub(readSubscription()); }, []);
  const planName = sub?.label ?? "Basic";   // es. "Basic personalizzato"
  const monthly = sub?.monthlyTotal ?? 0;   // piano + moduli extra
  const added = sub?.addedModules ?? [];    // moduli non inclusi nel piano
  const [billing, setBilling] = useState<{ businessName?: string; vat?: string; taxCode?: string; address?: string; sdi?: string; pec?: string; email?: string }>({});
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:billing"); if (r) setBilling(JSON.parse(r)); } catch {} }, []);

  const fmtMonth = (d: Date) => d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const fmtDay = (d: Date | null) => (d ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

  // Ultime 6 mensilità (dimostrative): la più recente "da incassare", le precedenti incassate.
  const invoices = useMemo<Invoice[]>(() => {
    const now = new Date();
    const months: Date[] = [new Date(now.getFullYear(), now.getMonth(), 1)]; // solo l'ultima (mese corrente)
    const perYear: Record<number, number> = {};
    const rows = months.map((d) => {
      const y = d.getFullYear();
      perYear[y] = (perYear[y] ?? 0) + 1;
      const amount = monthly;
      const net = Math.round((amount / (1 + VAT)) * 100) / 100;
      const tax = Math.round((amount - net) * 100) / 100;
      const isCurrent = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      return {
        date: d,
        due: new Date(d.getFullYear(), d.getMonth() + 1, 1), // scadenza = rinnovo (1° del mese successivo)
        number: `${String(perYear[y]).padStart(4, "0")}/${y}`,
        description: `${t("Rinnovo abbonamento Xenora")} · ${t("Piano")} ${planName} · ${fmtMonth(d)}${added.length ? ` · +${added.length} ${t("moduli extra")}` : ""}`,
        net, tax, amount,
        method: "Carta ••4242",
        paidOn: isCurrent ? null : new Date(d.getFullYear(), d.getMonth(), 3),
      } as Invoice;
    });
    return rows.reverse(); // più recente in alto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthly, planName, added]);

  const tot = invoices.reduce((a, iv) => ({ net: a.net + iv.net, tax: a.tax + iv.tax, amount: a.amount + iv.amount }), { net: 0, tax: 0, amount: 0 });

  const stMeta = (s: InvStatus) => s === "paid" ? { label: t("Pagata"), c: "var(--ok)" } : s === "overdue" ? { label: t("Scaduta"), c: "var(--err)" } : { label: t("Da pagare"), c: "var(--warn)" };

  // Stampa/scarica la singola fattura come documento.
  const stampaFattura = (iv: Invoice) => {
    const w = window.open("", "_blank", "width=800,height=1000");
    if (!w) return;
    const esc = (s: string) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const b = billing;
    const clientRows = [
      b.businessName ? `<div><b>${esc(b.businessName)}</b></div>` : "",
      b.vat ? `<div>P.IVA ${esc(b.vat)}</div>` : "",
      b.taxCode ? `<div>C.F. ${esc(b.taxCode)}</div>` : "",
      b.address ? `<div>${esc(b.address)}</div>` : "",
      b.sdi ? `<div>SDI ${esc(b.sdi)}</div>` : "",
      b.pec ? `<div>PEC ${esc(b.pec)}</div>` : "",
    ].filter(Boolean).join("");
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Fattura ${esc(iv.number)} · Xenora</title><style>
@page{size:A4;margin:16mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#1f2430;margin:0;font-size:13px}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #285f92;padding-bottom:14px}
.brand{font-size:22px;font-weight:800;color:#285f92}
.brand small{display:block;font-size:11px;font-weight:400;color:#6b7280;letter-spacing:.03em}
.doc{text-align:right}
.doc .n{font-size:20px;font-weight:800}
.doc .d{color:#6b7280;font-size:12px}
.parties{display:flex;justify-content:space-between;gap:20px;margin:22px 0}
.parties h3{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#9aa1ac;margin:0 0 6px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{text-align:left;text-transform:uppercase;letter-spacing:.04em;font-size:10px;color:#9aa1ac;border-bottom:2px solid #e6e8ec;padding:9px 8px}
td{padding:11px 8px;border-bottom:1px solid #f0ebe3}
.r{text-align:right}.mono{font-family:'Courier New',monospace}
.tot{margin-top:14px;margin-left:auto;width:280px}
.tot .row{display:flex;justify-content:space-between;padding:6px 8px;font-size:13px}
.tot .grand{border-top:2px solid #e6e8ec;font-weight:800;font-size:16px;color:#285f92}
.status{margin-top:22px;display:inline-block;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700}
.foot{margin-top:32px;color:#9aa1ac;font-size:10px;border-top:1px solid #ece7df;padding-top:10px}
</style></head><body>
<div class="top">
  <div class="brand">Xenora<small>Digital Solutions · Channel Manager & PMS</small></div>
  <div class="doc"><div style="font-size:11px;letter-spacing:.12em;color:#9aa1ac;text-transform:uppercase;font-weight:700">Fattura</div><div class="n">${esc(iv.number)}</div><div class="d">Data ${fmtDay(iv.date)}</div><div class="d">Scadenza ${fmtDay(iv.due)}</div></div>
</div>
<div class="parties">
  <div><h3>Fornitore</h3><div><b>Xenora Digital Solutions</b></div><div>xenora.it</div></div>
  <div style="text-align:right"><h3>Cliente</h3>${clientRows || '<div style="color:#9aa1ac">— dati di fatturazione non impostati —</div>'}</div>
</div>
<table>
  <thead><tr><th>Descrizione</th><th class="r">Prezzo netto</th><th class="r">IVA 22%</th><th class="r">Importo</th></tr></thead>
  <tbody><tr><td>${esc(iv.description)}</td><td class="r mono">${eur(iv.net)}</td><td class="r mono">${eur(iv.tax)}</td><td class="r mono"><b>${eur(iv.amount)}</b></td></tr></tbody>
</table>
<div class="tot">
  <div class="row"><span>Imponibile</span><span class="mono">${eur(iv.net)}</span></div>
  <div class="row"><span>IVA 22%</span><span class="mono">${eur(iv.tax)}</span></div>
  <div class="row grand"><span>Totale</span><span class="mono">${eur(iv.amount)}</span></div>
</div>
<div style="margin-top:14px;color:#6b7280;font-size:12px">Metodo di pagamento: <b style="color:#1f2430">${esc(iv.method)}</b></div>
<div class="status" style="background:${iv.paidOn ? "#e6f4ea;color:#1a7f43" : "#fdf0e3;color:#b5720f"}">${iv.paidOn ? "Incassata il " + fmtDay(iv.paidOn) : "Da incassare"}</div>
<div class="foot">Documento generato da Xenora. In produzione la fattura è emessa elettronicamente (SDI).</div>
</body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div>
      <PageHeader title={t("Fatture")} subtitle={t("Le fatture del tuo abbonamento Xenora")} />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Card className="!p-4"><div className="text-xs text-dim">{t("Piano attivo")}</div><div className="mt-0.5 text-lg font-bold text-txt">{planName}</div>{added.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{added.map((m) => <span key={m.key} className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: "color-mix(in srgb, var(--focus) 40%, var(--line))", color: "var(--focus)" }}>{m.name}</span>)}</div>}</Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Canone mensile")}</div><div className="mt-0.5 font-mono text-lg font-bold text-txt">{eur(monthly)} <span className="text-[11px] font-normal text-faint">{t("IVA inclusa")}</span></div><div className="mt-0.5 text-[11px] text-faint">{t("Netto")} {eur(Math.round((monthly / (1 + VAT)) * 100) / 100)} + {t("IVA")} 22% {eur(Math.round((monthly - monthly / (1 + VAT)) * 100) / 100)}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Prossimo rinnovo")}</div><div className="mt-0.5 text-lg font-bold text-txt">{fmtDay(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1))}</div><div className="mt-0.5 text-[11px] text-faint">{t("Rinnovo il 1° di ogni mese")}</div></Card>
      </div>

      <Card>
        <SectionTitle>{t("Storico fatture")}</SectionTitle>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <colgroup>
              <col style={{ width: 110 }} /><col style={{ width: 74 }} /><col /><col style={{ width: 100 }} />
              <col style={{ width: 104 }} /><col style={{ width: 84 }} /><col style={{ width: 100 }} />
              <col style={{ width: 122 }} /><col style={{ width: 106 }} /><col style={{ width: 108 }} /><col style={{ width: 52 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-3 py-2 font-semibold">{t("Data fatturazione")}</th>
                <th className="px-3 py-2 font-semibold">{t("Numero")}</th>
                <th className="px-3 py-2 font-semibold">{t("Descrizione")}</th>
                <th className="px-3 py-2 font-semibold">{t("Scadenza")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Prezzo netto")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Importo IVA")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("Importo")}</th>
                <th className="px-3 py-2 font-semibold">{t("Metodo")}</th>
                <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
                <th className="px-3 py-2 font-semibold">{t("Incassato il")}</th>
                <th className="px-3 py-2 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((iv) => { const s = stMeta(statusOf(iv)); return (
                <tr key={iv.number} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 text-txt">{fmtDay(iv.date)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-dim">{iv.number}</td>
                  <td className="px-3 py-2.5 capitalize text-txt">{iv.description}</td>
                  <td className="px-3 py-2.5 text-dim">{fmtDay(iv.due)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-dim">{eur(iv.net)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-dim">{eur(iv.tax)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(iv.amount)}</td>
                  <td className="px-3 py-2.5 text-dim">{iv.method}</td>
                  <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${s.c} 16%, transparent)`, color: s.c }}>{s.label}</span></td>
                  <td className="px-3 py-2.5 text-txt">{iv.paidOn ? fmtDay(iv.paidOn) : "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button onClick={() => stampaFattura(iv)} title={t("Stampa fattura")} aria-label={t("Stampa fattura")} className="inline-grid h-8 w-8 place-items-center rounded-lg border border-line text-dim transition hover:bg-wash hover:text-txt">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6z" /></svg>
                    </button>
                  </td>
                </tr>
              ); })}
            </tbody>
            {invoices.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td className="px-3 py-2.5 text-txt" colSpan={4}>{t("Totale")}</td>
                <td className="px-3 py-2.5 text-right font-mono text-txt">{eur(tot.net)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-txt">{eur(tot.tax)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-txt">{eur(tot.amount)}</td>
                <td className="px-3 py-2.5" colSpan={4}></td>
              </tr>
            </tfoot>
            )}
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">{t("Elenco dimostrativo. In produzione le fatture sono emesse automaticamente a ogni rinnovo (Stripe + fattura elettronica) e scaricabili in PDF.")}</p>
      </Card>
    </div>
  );
}
