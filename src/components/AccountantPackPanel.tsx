"use client";

// Riquadro "Riepilogo per il commercialista" del Fascicolo fiscale. Solo presentazione: tutta la logica
// di aggregazione vive in lib/accountant-pack.ts (funzioni pure con test). Nessun calcolo fiscale nuovo.
import { useMemo, useState } from "react";
import { cityTaxOfBooking } from "@/lib/booking";
import { downloadCsv } from "@/lib/invoicing/csv";
import type { Booking, Structure } from "@/lib/types";
import {
  FIC_SHARE_STEPS, OPEN_QUESTIONS, buildAccountantPack, currentPeriod, dmy, fmtEurCents, invoicesCsv, parsePeriodKey, periodKey, purchasesCsv, summaryCsv,
  type PackDoc, type PackPayment, type PackPurchase, type PackPeriod,
} from "@/lib/accountant-pack";

interface Props {
  docs: PackDoc[]; payments: PackPayment[]; trialIds: ReadonlySet<string>; purchases: PackPurchase[];
  bookings: Booking[]; getStructure: (id: string) => Structure | undefined;
  structureId: string; structureLabel: string; years: number[];
  ficLinked: boolean; loading: boolean; warnings: string[];
}

const box = "rounded-lg border border-line bg-paper p-3";
const h = "mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim";
const th = "whitespace-nowrap px-2 py-1.5 font-semibold";
const td = "whitespace-nowrap px-2 py-1.5";
const btn = "whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-50";

export default function AccountantPackPanel({ docs, payments, trialIds, purchases, bookings, getStructure, structureId, structureLabel, years, ficLinked, loading, warnings }: Props) {
  const [key, setKey] = useState(() => periodKey(currentPeriod()));
  const period: PackPeriod = useMemo(() => parsePeriodKey(key) ?? currentPeriod(), [key]);

  const options = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const y of years) {
      out.push({ value: `${y}-Y`, label: `Anno ${y}` });
      for (const q of [4, 3, 2, 1]) out.push({ value: `${y}-Q${q}`, label: `${q}º trimestre ${y}` });
    }
    return out;
  }, [years]);

  const pack = useMemo(() => buildAccountantPack({
    period, structureId, structureLabel, docs, payments, trialIds, purchases,
    bookings,
    cityTaxOf: (b) => { const bk = b as unknown as Booking; const st = getStructure(bk.structureId); return st?.cityTax ? cityTaxOfBooking(st, bk) : null; },
  }), [period, structureId, structureLabel, docs, payments, trialIds, purchases, bookings, getStructure]);

  const get = (f: { filename: string; csv: string }) => downloadCsv(f.filename, f.csv);
  const inv = pack.invoices;
  const t = inv.totals;
  const eurE = (euro: number) => fmtEurCents(Math.round(euro * 100));

  return (
    <div className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div className="text-sm font-bold text-txt">Riepilogo per il commercialista</div>
          <div className="text-[11px] text-faint">{pack.range.label} · {dmy(pack.range.from)} – {dmy(pack.range.lastDay)} · {structureLabel}</div>
        </div>
        <select value={key} onChange={(e) => setKey(e.target.value)} aria-label="Periodo" className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-txt outline-none focus:border-focus">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button onClick={() => get(invoicesCsv(pack))} disabled={loading || inv.rows.length === 0} className={btn}>Fatture emesse (CSV)</button>
        <button onClick={() => get(purchasesCsv(pack))} disabled={loading || pack.purchases.count === 0} className={btn}>Fatture passive (CSV)</button>
        <button onClick={() => get(summaryCsv(pack))} disabled={loading} className={btn}>Riepilogo (CSV)</button>
      </div>
      {warnings.map((w) => <p key={w} className="mt-2 text-[11px] text-[color:var(--warn)]">{w}</p>)}

      {loading ? <p className="mt-3 text-xs text-faint">Caricamento…</p> : (<>
        {/* Fatture emesse */}
        <div className="mt-3">
          <div className={h}>Fatture emesse nel periodo ({inv.nFatture} fatture{inv.nNoteCredito ? `, ${inv.nNoteCredito} note di credito` : ""})</div>
          <div className="max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-wash"><tr className="text-left uppercase tracking-wide text-dim">
                <th className={th}>Data</th><th className={th}>N.</th><th className={th}>Cliente</th>
                <th className={`${th} text-right`}>Imponibile</th><th className={`${th} text-right`}>Fuori campo IVA</th><th className={`${th} text-right`}>Bollo</th><th className={`${th} text-right`}>Totale</th><th className={th}>Stato</th>
              </tr></thead>
              <tbody>
                {inv.rows.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className={`${td} font-mono text-dim`}>{dmy(r.date)}</td>
                    <td className={`${td} font-mono text-txt`}>{r.number || "—"}{r.tipo === "Nota di credito" ? " (NC)" : ""}</td>
                    <td className={`${td} max-w-[180px] truncate text-txt`}>{r.customer || "—"}</td>
                    <td className={`${td} text-right font-mono`}>{fmtEurCents(r.taxable)}</td>
                    <td className={`${td} text-right font-mono text-dim`}>{r.outOfScope ? fmtEurCents(r.outOfScope) : "—"}</td>
                    <td className={`${td} text-right font-mono text-dim`}>{r.bollo ? fmtEurCents(r.bollo) : "—"}</td>
                    <td className={`${td} text-right font-mono font-semibold text-txt`}>{fmtEurCents(r.total)}</td>
                    <td className={`${td} ${r.trial || r.notSent ? "font-medium text-[color:var(--warn)]" : "text-dim"}`}>{r.statoLabel}</td>
                  </tr>
                ))}
                {inv.rows.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-faint">Nessuna fattura emessa nel periodo.</td></tr>}
              </tbody>
              {inv.rows.length > 0 && (
                <tfoot className="sticky bottom-0 bg-wash"><tr className="border-t border-line font-semibold text-txt">
                  <td className={td} colSpan={3}>Totale (note di credito in negativo)</td>
                  <td className={`${td} text-right font-mono`}>{fmtEurCents(t.taxable)}</td>
                  <td className={`${td} text-right font-mono`}>{fmtEurCents(t.outOfScope)}</td>
                  <td className={`${td} text-right font-mono`}>{fmtEurCents(t.bollo)}</td>
                  <td className={`${td} text-right font-mono`}>{fmtEurCents(t.total)}</td>
                  <td className={td}>IVA {fmtEurCents(t.vat)}</td>
                </tr></tfoot>
              )}
            </table>
          </div>
          {(inv.drafts > 0 || inv.rejected > 0 || inv.annulled > 0) && (
            <p className="mt-1 text-[11px] text-faint">Esclusi dai totali: {inv.drafts} bozze · {inv.rejected} scartate dallo SdI · {inv.annulled} stornate.</p>
          )}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {/* Bollo */}
          <div className={box}>
            <div className={h}>Bollo del periodo</div>
            <div className="text-xs text-txt"><b className="font-mono">{pack.bollo.count}</b> documenti con bollo · <b className="font-mono">{fmtEurCents(pack.bollo.cents)}</b></div>
            <ul className="mt-1 space-y-0.5 text-[11px] text-dim">
              {pack.bollo.quarters.map((q) => (
                <li key={q.q} className="whitespace-nowrap">{q.q}º trim.: {fmtEurCents(q.cents)} · F24 entro <b className="font-mono text-txt">{dmy(q.dueDate)}</b> (tributo {q.tributo}){q.postponable ? " · rinviabile" : ""}</li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-faint">Scadenze indicative, da confermare con il commercialista.</p>
          </div>

          {/* Imposta di soggiorno */}
          <div className={box}>
            <div className={h}>Imposta di soggiorno (arrivi del periodo)</div>
            {pack.cityTax.enabled ? (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><div className="text-[11px] text-dim">Dovuta (da versare al Comune)</div><div className="font-mono font-bold text-txt">{eurE(pack.cityTax.dovuta)}</div></div>
                <div><div className="text-[11px] text-dim">Incassata</div><div className="font-mono font-bold" style={{ color: "var(--ok)" }}>{eurE(pack.cityTax.incassata)}</div></div>
                <div><div className="text-[11px] text-dim">Da incassare</div><div className="font-mono font-bold" style={{ color: "var(--warn)" }}>{eurE(pack.cityTax.daIncassare)}</div></div>
              </div>
            ) : <p className="text-xs text-faint">Non configurata per la struttura.</p>}
          </div>

          {/* Incassi */}
          <div className={box}>
            <div className={h}>Incassi del periodo (per metodo)</div>
            {pack.incassi.rows.length === 0 ? <p className="text-xs text-faint">Nessun incasso registrato sui documenti.</p> : (
              <ul className="space-y-0.5 text-xs">
                {pack.incassi.rows.map((r) => <li key={r.method} className="flex justify-between gap-2 whitespace-nowrap"><span className="text-dim">{r.method} ({r.count})</span><span className="font-mono text-txt">{fmtEurCents(r.cents)}</span></li>)}
                <li className="flex justify-between gap-2 whitespace-nowrap border-t border-line pt-0.5 font-semibold"><span className="text-txt">Totale</span><span className="font-mono text-txt">{fmtEurCents(pack.incassi.cents)}</span></li>
              </ul>
            )}
            <p className="mt-1 text-[11px] text-faint">Solo i pagamenti registrati sui documenti fiscali.</p>
          </div>

          {/* Non incassate */}
          <div className={box}>
            <div className={h}>Fatture del periodo non ancora incassate</div>
            <div className="text-xs text-txt"><b className="font-mono">{pack.unpaid.count}</b> fatture · residuo <b className="font-mono">{fmtEurCents(pack.unpaid.cents)}</b></div>
            {pack.unpaid.rows.length > 0 && (
              <ul className="mt-1 max-h-24 space-y-0.5 overflow-auto text-[11px] text-dim">
                {pack.unpaid.rows.map((r) => <li key={r.id} className="whitespace-nowrap">{r.number || "—"} · {r.customer || "—"} · <span className="font-mono text-txt">{fmtEurCents(r.residuo)}</span></li>)}
              </ul>
            )}
          </div>

          {/* Passive */}
          <div className={box}>
            <div className={h}>Fatture passive del periodo</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><div className="text-[11px] text-dim">Documenti</div><div className="font-mono font-bold text-txt">{pack.purchases.count}</div></div>
              <div><div className="text-[11px] text-dim">Totale</div><div className="font-mono font-bold text-txt">{fmtEurCents(pack.purchases.total)}</div></div>
              <div><div className="text-[11px] text-dim">IVA</div><div className="font-mono font-bold text-txt">{fmtEurCents(pack.purchases.vat)}</div></div>
            </div>
            <p className="mt-1 text-[11px] text-dim">{pack.purchases.unpaidCount} non ancora pagate ({fmtEurCents(pack.purchases.unpaidCents)})</p>
          </div>

          {/* Checklist */}
          <div className={box}>
            <div className={h}>Da chiedere/confermare al commercialista</div>
            {pack.checklist.length === 0 ? <p className="text-xs text-faint">Nessun punto aperto dai dati.</p> : (
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-txt">{pack.checklist.map((c) => <li key={c}>{c}</li>)}</ul>
            )}
          </div>
        </div>

        {/* Domande aperte */}
        <div className="mt-3 rounded-lg border border-line bg-paper p-3">
          <div className={h}>Domande aperte da portare al commercialista</div>
          <div className="grid gap-3 md:grid-cols-3">
            {OPEN_QUESTIONS.map((g) => (
              <div key={g.title}>
                <div className="text-[11px] font-semibold text-txt">{g.title}</div>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] text-dim">{g.items.map((q) => <li key={q}>{q}</li>)}</ul>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-faint">Sono solo promemoria di domande: Xenora non fornisce risposte fiscali.</p>
        </div>

        {/* Condivisione con il commercialista su Fatture in Cloud */}
        {ficLinked && (
          <div className="mt-3 rounded-lg border border-line bg-paper p-3">
            <div className={h}>Condividere l&apos;accesso su Fatture in Cloud</div>
            <p className="text-[11px] text-dim">{FIC_SHARE_STEPS}</p>
          </div>
        )}
      </>)}
    </div>
  );
}
