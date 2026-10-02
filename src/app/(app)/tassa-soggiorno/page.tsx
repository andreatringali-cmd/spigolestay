"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { cityTaxForBooking, cityTaxRulesOf, DEFAULT_CITY_TAX_RULES } from "@/lib/citytax";

const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const pad2 = (n: number) => String(n).padStart(2, "0");

export default function TassaSoggiornoPage() {
  const { t } = useLang();
  const { bookings, guests, structures, getStructure, activeStructureId } = useData();

  // Regole: con UNA struttura selezionata partono dalla sua configurazione (Strutture → Tassa di
  // soggiorno) e si possono ritoccare qui per una simulazione; con "Tutte" ogni prenotazione usa
  // le regole della propria struttura (sola lettura).
  const activeSt = activeStructureId === "all" ? undefined : getStructure(activeStructureId);
  const stRules = cityTaxRulesOf(activeSt);
  const base = stRules ?? DEFAULT_CITY_TAX_RULES;
  const [taxMode, setTaxMode] = useState<"percentuale" | "fisso">(base.taxMode);
  const [amount, setAmount] = useState(base.amount);   // € per persona/notte (modalità fisso)
  const [pct, setPct] = useState(base.pct);            // % del pernottamento (modalità percentuale)
  const [cap, setCap] = useState(base.cap);            // tetto massimo € per persona/notte (0 = nessun tetto)
  const [maxNights, setMaxNights] = useState(base.maxNights);
  const [childrenExempt, setChildrenExempt] = useState(base.childrenExempt);
  const [exemptAge, setExemptAge] = useState(base.exemptAge); // esenti sotto questa età
  const rulesSig = JSON.stringify(stRules);
  useEffect(() => {
    const r = stRules ?? DEFAULT_CITY_TAX_RULES;
    setTaxMode(r.taxMode); setAmount(r.amount); setPct(r.pct); setCap(r.cap); setMaxNights(r.maxNights); setChildrenExempt(r.childrenExempt); setExemptAge(r.exemptAge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStructureId, rulesSig]);
  const single = activeStructureId !== "all";
  const taxOn = single ? !!activeSt?.cityTax : structures.some((s) => !!s.cityTax);
  // Comune: della struttura selezionata; con "Tutte" l'elenco dei comuni configurati.
  const comune = single
    ? (activeSt?.cityTaxComune?.trim() || "")
    : [...new Set(structures.filter((s) => s.cityTax).map((s) => s.cityTaxComune?.trim()).filter(Boolean) as string[])].join(", ");
  const comuneLabel = comune || t("comune non indicato");

  // Periodo
  const [mode, setMode] = useState<"mese" | "trimestre">("trimestre");
  const [year, setYear] = useState(new Date().getFullYear());
  // Anni selezionabili: anno corrente ±1 più gli anni delle prenotazioni.
  const years = useMemo(() => {
    const cur = new Date().getFullYear();
    const ys = new Set<number>([cur - 1, cur, cur + 1, year]);
    bookings.forEach((b) => { const y = Number(b.checkIn.slice(0, 4)); if (y >= 2000) ys.add(y); });
    return [...ys].sort((a, b) => a - b);
  }, [bookings, year]);
  const [month, setMonth] = useState(new Date().getMonth()); // 0-11
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1); // 1-4

  const { start, end, label } = useMemo(() => {
    if (mode === "mese") {
      const s = `${year}-${pad2(month + 1)}-01`;
      const e = month === 11 ? `${year + 1}-01-01` : `${year}-${pad2(month + 2)}-01`;
      return { start: s, end: e, label: `${MONTHS[month]} ${year}` };
    }
    const startM = (quarter - 1) * 3;
    const s = `${year}-${pad2(startM + 1)}-01`;
    const e = startM + 3 >= 12 ? `${year + 1}-01-01` : `${year}-${pad2(startM + 4)}-01`;
    return { start: s, end: e, label: `${quarter}º trimestre ${year}` };
  }, [mode, year, month, quarter]);

  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "";
  const guestCountry = (id: string) => guests.find((g) => g.id === id)?.country || "Non indicata";

  // Prenotazioni con arrivo nel periodo.
  const inPeriod = bookings.filter(
    (b) => b.status !== "cancelled" && b.channel !== "blocked" && (activeStructureId === "all" || b.structureId === activeStructureId) && b.checkIn >= start && b.checkIn < end
  );

  const rows = inPeriod.flatMap((b) => {
    // Logica unica in @/lib/citytax (condivisa con "Elabora tutto" degli Adempimenti).
    // Struttura selezionata: regole mostrate sotto (modificabili); "Tutte": regole della struttura della prenotazione.
    const rules = single ? { taxMode, amount, pct, cap, maxNights, childrenExempt, exemptAge } : cityTaxRulesOf(getStructure(b.structureId));
    if (!rules || (single && !taxOn)) return []; // struttura senza tassa di soggiorno attiva
    const { persons, taxable, tax } = cityTaxForBooking(b, rules);
    return [{ b, persons, taxable, tax }];
  });
  const total = rows.reduce((a, r) => a + r.tax, 0);

  // ISTAT — movimento turistico del periodo (arrivi + presenze per provenienza).
  const istat = useMemo(() => {
    const map = new Map<string, { arrivi: number; presenze: number }>();
    for (const b of inPeriod) {
      const key = guestCountry(b.guestId);
      const cur = map.get(key) ?? { arrivi: 0, presenze: 0 };
      cur.arrivi += 1;
      cur.presenze += (b.adults + b.children) * nights(b.checkIn, b.checkOut);
      map.set(key, cur);
    }
    return [...map.entries()].map(([paese, v]) => ({ paese, ...v })).sort((a, b) => b.presenze - a.presenze);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPeriod]);
  const totArrivi = istat.reduce((a, r) => a + r.arrivi, 0);
  const totPresenze = istat.reduce((a, r) => a + r.presenze, 0);

  const stampaDichiarazione = () => {
    const w = window.open("", "_blank", "width=820,height=940");
    if (!w) return;
    const money = (x: number) => "€ " + x.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const struttura = activeStructureId === "all" ? "Tutte le strutture" : getStructure(activeStructureId)?.name ?? "";
    const totPax = rows.reduce((a, r) => a + r.persons, 0);
    const totNotti = rows.reduce((a, r) => a + r.taxable, 0);
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Dichiarazione imposta di soggiorno — ${label}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Georgia,serif;color:#1f2127;margin:0;padding:48px 54px;font-size:14px;line-height:1.5}
      .head{border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:24px}
      .brand{font-size:24px;font-weight:700;color:#4f46e5}
      h1{font-size:15px;letter-spacing:1.5px;text-transform:uppercase;color:#5f6067;margin:0 0 4px}
      table{width:100%;border-collapse:collapse;margin-top:14px}
      td,th{padding:9px 6px;border-bottom:1px solid #e5e5e8;text-align:left}
      td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
      tr.tot td{border-top:2px solid #1f2127;font-weight:700;font-size:16px}
      .meta{color:#5f6067;font-size:13px;margin:2px 0}
    </style></head><body>
      <div class="head"><div class="brand">Xenora</div><div class="meta">${struttura}${comune ? " · " + comune : ""}</div></div>
      <h1>Dichiarazione imposta di soggiorno</h1>
      <div class="meta">Periodo: <b>${label}</b>${comune ? " — Comune di " + comune : ""}</div>
      <table>
        <tr><th>Voce</th><th class="n">Valore</th></tr>
        <tr><td>Pernottamenti soggetti a imposta</td><td class="n">${totNotti}</td></tr>
        <tr><td>Persone paganti</td><td class="n">${totPax}</td></tr>
        <tr><td>Tariffa applicata</td><td class="n">${!single ? "secondo le regole di ciascuna struttura" : taxMode === "percentuale" ? `${pct}% del pernottamento${cap > 0 ? ` · max ${money(cap)}/persona/notte` : ""}` : `${money(amount)} / persona / notte`}</td></tr>
        <tr class="tot"><td>Totale imposta da versare</td><td class="n">${money(total)}</td></tr>
      </table>
      <p class="meta" style="margin-top:28px">Regole applicate: ${single ? `max ${maxNights} notti per soggiorno${childrenExempt ? ", minori esenti" : ""}` : "quelle configurate per ciascuna struttura"}. Documento riepilogativo non ufficiale generato da Xenora.</p>
      <script>window.onload=function(){window.print()}<\/script>
    </body></html>`);
    w.document.close();
  };

  // Export CSV (compatibile con fogli di calcolo e caricamenti).
  const downloadCsv = (name: string, header: string[], data: (string | number)[][]) => {
    const cell = (v: string | number) => { const s = String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + [header, ...data].map((r) => r.map(cell).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportImpostaCsv = () => downloadCsv(
    `imposta-soggiorno_${label.replace(/\s+/g, "-")}.csv`,
    ["Ospite", "Provenienza", "Check-in", "Check-out", "Persone paganti", "Notti tassabili", "Imposta €"],
    rows.map(({ b, persons, taxable, tax }) => [guestName(b.guestId), guestCountry(b.guestId), b.checkIn, b.checkOut, persons, taxable, tax.toFixed(2)]),
  );
  const exportIstatCsv = () => downloadCsv(
    `istat-movimento_${label.replace(/\s+/g, "-")}.csv`,
    ["Provenienza", "Arrivi", "Presenze"],
    [...istat.map((r) => [r.paese, r.arrivi, r.presenze]), ["TOTALE", totArrivi, totPresenze]],
  );

  return (
    <div>
      <PageHeader
        title={t("Tassa di soggiorno")}
        subtitle={t("Partita di giro · esclusa da ricavi e statistiche")}
        actions={<button onClick={stampaDichiarazione} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white">{t("Stampa dichiarazione")}</button>}
      />

      {/* Periodo */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center rounded-lg border border-line p-0.5">
            <Toggle active={mode === "mese"} onClick={() => setMode("mese")}>{t("Mese")}</Toggle>
            <Toggle active={mode === "trimestre"} onClick={() => setMode("trimestre")}>{t("Trimestre")}</Toggle>
          </div>
          {mode === "mese" ? (
            <label className="text-xs text-dim">{t("Mese")}<select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={sel}>{MONTHS.map((m, i) => (<option key={m} value={i}>{t(m)}</option>))}</select></label>
          ) : (
            <label className="text-xs text-dim">{t("Trimestre")}<select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} className={sel}>{[1, 2, 3, 4].map((q) => (<option key={q} value={q}>{q}º {t("trimestre")}</option>))}</select></label>
          )}
          <label className="text-xs text-dim">{t("Anno")}<select value={year} onChange={(e) => setYear(Number(e.target.value))} className={sel}>{years.map((y) => (<option key={y} value={y}>{y}</option>))}</select></label>
          <div className="ml-auto text-right">
            <div className="text-xs text-dim">{t("Imposta da versare")} · {label}</div>
            <div className="font-mono text-2xl font-bold text-txt">{eur(total)}</div>
          </div>
        </div>
      </Card>

      {/* Regole */}
      <Card className="mb-5">
        <SectionTitle>{t("Regole")} ({comuneLabel})</SectionTitle>
        {!single && <p className="mb-2 text-xs text-dim">{t("Con «Tutte le strutture» ogni soggiorno è calcolato con le regole della propria struttura (Strutture → Tassa di soggiorno). Seleziona una struttura in alto a destra per vederle e simularne di diverse.")}</p>}
        {single && !taxOn && <p className="mb-2 text-xs text-[color:var(--warn)]">{t("Tassa di soggiorno non attiva per questa struttura: attivala in Strutture per calcolarla.")}</p>}
        <div className={single ? "" : "pointer-events-none opacity-50"}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center rounded-lg border border-line p-0.5">
            <Toggle active={taxMode === "percentuale"} onClick={() => setTaxMode("percentuale")}>{t("Percentuale")}</Toggle>
            <Toggle active={taxMode === "fisso"} onClick={() => setTaxMode("fisso")}>{t("Importo fisso")}</Toggle>
          </div>
          {taxMode === "percentuale" ? (
            <>
              <Field label={t("% del pernottamento")}><input type="number" step="0.5" value={pct} onChange={(e) => setPct(Number(e.target.value))} className={inp} /></Field>
              <Field label={t("Tetto € persona/notte")}><input type="number" step="0.5" value={cap} onChange={(e) => setCap(Number(e.target.value))} className={inp} /></Field>
            </>
          ) : (
            <Field label={t("€ per persona/notte")}><input type="number" step="0.5" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className={inp} /></Field>
          )}
          <Field label={t("Max notti tassabili")}><input type="number" value={maxNights} onChange={(e) => setMaxNights(Number(e.target.value))} className={inp} /></Field>
          <Field label={t("Esenti sotto i (anni)")}><input type="number" value={exemptAge} onChange={(e) => setExemptAge(Number(e.target.value))} className={inp} /></Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-dim">
            <input type="checkbox" checked={childrenExempt} onChange={(e) => setChildrenExempt(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" />
            {t("Minori esenti (senza età)")}
          </label>
        </div>
        {taxMode === "percentuale" && <p className="mt-2 text-[11px] text-faint">{t("Modalità percentuale: (prezzo camera ÷ ospiti) × % indicata, con tetto a persona/notte e massimo di notti tassabili. Verifica esenzioni, dichiarazione e scadenze di versamento sul portale del Comune.")}</p>}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Dettaglio imposta */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle>{t("Dettaglio imposta")} ({rows.length})</SectionTitle>
            <button onClick={exportImpostaCsv} disabled={!rows.length} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-dim hover:bg-wash hover:text-txt disabled:opacity-40">{t("Esporta CSV")}</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-3 py-2 font-semibold">{t("Ospite")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Pers.")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Notti")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Tassa")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ b, persons, taxable, tax }) => (
                  <tr key={b.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-txt">{guestName(b.guestId)}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{persons}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{taxable}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-txt">{eur(tax)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-faint">{t("Nessun soggiorno nel periodo.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* ISTAT */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle>{t("Movimento turistico (ISTAT)")} — {label}</SectionTitle>
            <button onClick={exportIstatCsv} disabled={!istat.length} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-dim hover:bg-wash hover:text-txt disabled:opacity-40">{t("Esporta ISTAT (CSV)")}</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-3 py-2 font-semibold">{t("Provenienza")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Arrivi")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Presenze")}</th>
                </tr>
              </thead>
              <tbody>
                {istat.map((r) => (
                  <tr key={r.paese} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-txt">{r.paese}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{r.arrivi}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{r.presenze}</td>
                  </tr>
                ))}
                {istat.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-sm text-faint">{t("Nessun movimento nel periodo.")}</td></tr>}
              </tbody>
              {istat.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-line font-semibold text-txt">
                    <td className="px-3 py-2">{t("Totale")}</td>
                    <td className="px-3 py-2 text-right font-mono">{totArrivi}</td>
                    <td className="px-3 py-2 text-right font-mono">{totPresenze}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="mt-2 text-xs text-faint">{t("Arrivi = ospiti in arrivo nel periodo · Presenze = pernottamenti totali (persone × notti).")}</p>
        </div>
      </div>
    </div>
  );
}

const inp = "w-28 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const sel = "mt-1 block rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs text-dim">{label}<div className="mt-1">{children}</div></label>;
}
function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${active ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{children}</button>;
}
