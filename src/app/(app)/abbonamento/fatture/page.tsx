"use client";

// Fatture dell'abbonamento: SOLO quelle reali, lette da Stripe (/api/stripe/invoices).
// Se Stripe non ne restituisce (errore di rete, Stripe non collegato, nessun abbonamento reale) si mostra un avviso o l'elenco vuoto:
// niente fatture di esempio presentate come reali.

import { fmtDate } from "@/lib/dates";
import { useEffect, useState } from "react";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { eur } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { readSubscription, type SubSummary, trialInfo, type TrialInfo } from "@/lib/plans";
import { useAuth } from "@/lib/authsync";

interface RealInvoice { number: string; created: number | null; due: number | null; paidAt: number | null; totalCents: number; subtotalCents: number; taxCents: number; currency: string; status: string | null; pdfUrl: string | null; hostedUrl: string | null; description: string }

const VAT = 0.22; // IVA 22%

export default function FatturePage() {
  const { t } = useLang();
  const [sub, setSub] = useState<SubSummary | null>(null);
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  useEffect(() => { setSub(readSubscription()); setTrial(trialInfo()); }, []);
  const planName = sub?.label ?? "Basic";   // es. "Basic personalizzato"
  const monthly = sub?.monthlyTotal ?? 0;   // piano + moduli extra
  const added = sub?.addedModules ?? [];    // moduli non inclusi nel piano

  // Fatture reali dall'abbonamento Stripe.
  const { user } = useAuth();
  const [realInv, setRealInv] = useState<RealInvoice[]>([]);
  // Esito del caricamento: "loading" | "ok" | "notconfigured" (Stripe non collegato) | "err" (errore di rete o di Stripe).
  const [invState, setInvState] = useState<"loading" | "ok" | "notconfigured" | "err">("loading");
  useEffect(() => {
    const email = user?.email; if (!email) return;
    setInvState("loading");
    fetch(`/api/stripe/invoices?email=${encodeURIComponent(email)}`).then((r) => r.json()).then((j) => {
      if (Array.isArray(j.invoices)) setRealInv(j.invoices);
      setInvState(j.configured === false ? "notconfigured" : j.error ? "err" : "ok");
    }).catch(() => setInvState("err"));
  }, [user?.email]);

  const fmtDay = (d: Date | null) => (d ? fmtDate(d) : "—");

  // Cosa scrivere quando non ci sono fatture reali da mostrare.
  const emptyText = invState === "loading" ? t("Caricamento fatture…")
    : invState === "err" ? t("Impossibile leggere le fatture da Stripe. Riprova più tardi: non vengono mostrate fatture di esempio.")
    : invState === "notconfigured" ? t("Il sistema di pagamento non è ancora collegato: nessuna fattura disponibile.")
    : trial?.inTrial ? t("Nessuna fattura durante la prova gratuita. La prima sarà emessa al termine della prova.")
    : t("Nessuna fattura ancora emessa.");

  return (
    <div>
      <PageHeader title={t("Fatture")} subtitle={t("Le fatture del tuo abbonamento Xenora")} />

      {trial?.inTrial && realInv.length === 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "color-mix(in srgb, var(--ok) 35%, var(--line))", backgroundColor: "color-mix(in srgb, var(--ok) 10%, transparent)", color: "var(--dim)" }}>
          <span className="grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: "var(--ok)" }}>✓</span>
          <span><b className="text-txt">{t("Prova gratuita in corso")}</b> — {t("hai")} {trial.daysLeft} {trial.daysLeft === 1 ? t("giorno") : t("giorni")} {t("di prova (fino al")} {fmtDay(trial.trialEnd)}). {t("Nessuna fattura durante la prova.")}</span>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Card className="!p-4"><div className="text-xs text-dim">{t("Piano attivo")}</div><div className="mt-0.5 text-lg font-bold text-txt">{planName}</div>{added.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{added.map((m) => <span key={m.key} className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: "color-mix(in srgb, var(--focus) 40%, var(--line))", color: "var(--focus)" }}>{m.name}</span>)}</div>}</Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Canone mensile")}</div><div className="mt-0.5 font-mono text-lg font-bold text-txt">{eur(monthly)} <span className="text-[11px] font-normal text-faint">{t("IVA inclusa")}</span></div><div className="mt-0.5 text-[11px] text-faint">{t("Netto")} {eur(Math.round((monthly / (1 + VAT)) * 100) / 100)} + {t("IVA")} 22% {eur(Math.round((monthly - monthly / (1 + VAT)) * 100) / 100)}</div></Card>
        {/* Durante la prova la data della prima fattura è quella di fine prova; dopo, il rinnovo lo conosce solo Stripe: non si inventa una data. */}
        <Card className="!p-4"><div className="text-xs text-dim">{trial?.inTrial ? t("Prima fattura") : t("Prossimo rinnovo")}</div><div className="mt-0.5 text-lg font-bold text-txt">{trial?.inTrial ? fmtDay(trial.firstInvoice) : "—"}</div><div className="mt-0.5 text-[11px] text-faint">{trial?.inTrial ? t("Al termine della prova gratuita") : t("Vedi la data di rinnovo nel portale pagamenti")}</div></Card>
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
              {/* Fatture REALI da Stripe: sono il registro effettivo. */}
              {realInv.map((iv) => (
                <tr key={iv.number} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 text-txt">{iv.created ? fmtDay(new Date(iv.created)) : "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-dim">{iv.number}</td>
                  <td className="px-3 py-2.5 text-txt">{iv.description}</td>
                  <td className="px-3 py-2.5 text-dim">{iv.due ? fmtDay(new Date(iv.due)) : "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-dim">{eur(iv.subtotalCents / 100)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-dim">{eur(iv.taxCents / 100)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(iv.totalCents / 100)}</td>
                  <td className="px-3 py-2.5 text-dim">{t("Carta")}</td>
                  <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${iv.status === "paid" ? "var(--ok)" : iv.status === "open" ? "var(--warn)" : "var(--faint)"} 16%, transparent)`, color: iv.status === "paid" ? "var(--ok)" : iv.status === "open" ? "var(--warn)" : "var(--dim)" }}>{iv.status === "paid" ? t("Pagata") : iv.status === "open" ? t("Da pagare") : iv.status ?? "—"}</span></td>
                  <td className="px-3 py-2.5 text-txt">{iv.paidAt ? fmtDay(new Date(iv.paidAt)) : "—"}</td>
                  <td className="px-3 py-2.5 text-right">{iv.pdfUrl || iv.hostedUrl ? <a href={(iv.pdfUrl || iv.hostedUrl) as string} target="_blank" rel="noopener noreferrer" title={t("Scarica PDF")} className="inline-grid h-8 w-8 place-items-center rounded-lg border border-line text-dim transition hover:bg-wash hover:text-txt"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg></a> : "—"}</td>
                </tr>
              ))}
              {realInv.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-faint">{emptyText}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
