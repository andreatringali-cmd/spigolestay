"use client";

// Registro bollo virtuale: riepilogo dei bolli (2€) sui documenti EMESSI, per anno e trimestre,
// con scadenze di versamento indicative. Le bozze non contano (il bollo esiste solo a documento emesso).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { cashScopeOf, scopeVisible } from "@/lib/cassa";
import { PageHeader, StatCard, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import FilterSheet from "@/components/FilterSheet";
import { eur } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { STATO, DOC_KIND_LABEL } from "@/lib/invoicing/client";
import { bolloQuarters, quarterOf } from "@/lib/invoicing/bollo";
import { buildCsv, centsToCsv, downloadCsv } from "@/lib/invoicing/csv";
import { todayLocalISO } from "@/lib/invoicing/receivables";
import { friendlyError } from "@/lib/friendly-error";

interface Row { id: string; number_label: string | null; issue_date: string | null; bollo_cents: number; counterpart: { name?: string; lastName?: string } | null; structure_id: string | null; stato: string; doc_kind: string; regime: string | null }
const dmy = (iso: string) => fmtDate(iso);

export default function RegistroBolloPage() {
  const router = useRouter();
  const { allStructures, selectedStructureIds } = useData();
  const scope = useMemo(() => cashScopeOf(selectedStructureIds, allStructures.map((x) => x.id)), [selectedStructureIds, allStructures]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState<number | "all">("all");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.from("documents").select("id, number_label, issue_date, bollo_cents, counterpart, structure_id, stato, doc_kind, regime").gt("bollo_cents", 0).neq("stato", "bozza").order("issue_date", { ascending: false })
      .then(({ data, error }) => { if (error) setErr(friendlyError(error)); setRows((data ?? []) as Row[]); setLoading(false); });
  }, []);

  const scoped = useMemo(() => rows.filter((r) => scope === "all" || scopeVisible(r.structure_id, scope)), [rows, scope]);
  const years = useMemo(() => Array.from(new Set(scoped.map((r) => (r.issue_date ?? "").slice(0, 4)).filter(Boolean))).sort().reverse(), [scoped]);
  const ofYear = scoped.filter((r) => (r.issue_date ?? "").slice(0, 4) === String(year));
  const shown = quarter === "all" ? ofYear : ofYear.filter((r) => quarterOf(r.issue_date) === quarter);
  const quarters = useMemo(() => bolloQuarters(scoped, year), [scoped, year]);
  const totalYear = ofYear.reduce((a, r) => a + r.bollo_cents, 0);
  const rejected = ofYear.filter((r) => r.stato === "scartata");
  const cents = (c: number) => c / 100;
  const today = todayLocalISO();
  const sel = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus max-sm:h-9 max-sm:shrink-0 max-sm:px-2 max-sm:py-0 max-sm:text-[13px]";
  const structName = (id: string | null) => allStructures.find((s) => s.id === id)?.name ?? "—";
  const cpName = (r: Row) => `${r.counterpart?.name ?? ""} ${r.counterpart?.lastName ?? ""}`.trim();

  const exportCsv = () => {
    const head = ["Data", "Trimestre", "Struttura", "Tipo", "Numero", "Cliente", "Stato", "Bollo"];
    const lines = shown.map((r) => [r.issue_date ? dmy(r.issue_date) : "", `${quarterOf(r.issue_date)}º`, structName(r.structure_id), DOC_KIND_LABEL[r.doc_kind] ?? r.doc_kind, r.number_label ?? "", cpName(r), STATO[r.stato]?.label ?? r.stato, centsToCsv(r.bollo_cents)]);
    downloadCsv(`registro-bollo-${year}${quarter !== "all" ? `-T${quarter}` : ""}`, buildCsv(head, lines));
  };

  const filterControls = (<>
    <select value={String(quarter)} onChange={(e) => setQuarter(e.target.value === "all" ? "all" : Number(e.target.value))} className={sel}><option value="all">Tutto l&apos;anno</option>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}º trimestre</option>)}</select>
    <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={sel}>{[...new Set([String(year), ...years])].map((y) => <option key={y} value={y}>{y}</option>)}</select>
  </>);
  const filtersActive = (quarter !== "all" ? 1 : 0) + (year !== new Date().getFullYear() ? 1 : 0);
  const resetFilters = () => { setQuarter("all"); setYear(new Date().getFullYear()); };

  return (
    <div>
      <PageHeader title="Registro bollo virtuale" subtitle="Imposta di bollo (2€) sui documenti emessi — da versare all'Agenzia delle Entrate"
        actions={<div className="flex flex-wrap items-center gap-2">
          {/* Telefono: i due filtri stanno dietro il pulsante «Filtri»; dal tablet in su restano inline come prima */}
          <div className="contents max-sm:hidden">{filterControls}</div>
          <FilterSheet count={filtersActive} onReset={resetFilters}>{filterControls}</FilterSheet>
          <button onClick={exportCsv} disabled={shown.length === 0} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50 max-sm:h-9 max-sm:shrink-0 max-sm:whitespace-nowrap max-sm:px-2.5 max-sm:py-0 max-sm:text-[13px]">Esporta CSV</button>
        </div>} />

      {err && <Card className="mb-4"><p className="text-sm text-[color:var(--err)]">{err}</p></Card>}

      <div className="mb-4 grid grid-cols-2 gap-3 max-sm:mb-3 max-sm:gap-2 sm:grid-cols-5">
        {quarters.map((q) => <StatCard key={q.q} label={`${q.q}º trimestre`} value={eur(cents(q.cents))} hint={`${q.count} doc.`} onClick={() => setQuarter(quarter === q.q ? "all" : q.q)} active={quarter === q.q} />)}
        <StatCard label={`Totale ${year}`} value={eur(cents(totalYear))} color="var(--focus)" hint={`${ofYear.length} doc.`} />
      </div>

      {rejected.length > 0 && (
        <Card className="mb-4"><p className="text-sm text-[color:var(--warn)]">{rejected.length} document{rejected.length === 1 ? "o" : "i"} con bollo {rejected.length === 1 ? "risulta scartato" : "risultano scartati"} dallo SdI ({eur(cents(rejected.reduce((a, r) => a + r.bollo_cents, 0)))}): sono inclusi nei totali. Verifica con il commercialista come trattarli se non vengono corretti e reinviati.</p></Card>
      )}

      <Card className="mb-4">
        <SectionTitle>Versamento (F24) — riferimento indicativo</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-dim"><th className="py-1.5 pr-2 font-semibold">Trimestre</th><th className="py-1.5 pr-2 font-semibold">Codice tributo</th><th className="py-1.5 pr-2 font-semibold">Scadenza</th><th className="py-1.5 pr-2 text-right font-semibold">Importo</th><th className="py-1.5 pl-2 font-semibold">Nota</th></tr></thead>
            <tbody>
              {quarters.map((q) => (
                <tr key={q.q} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2 text-txt">{q.q}º</td>
                  <td className="py-2 pr-2 font-mono text-dim">{q.tributo}</td>
                  <td className="whitespace-nowrap py-2 pr-2 text-dim">{dmy(q.dueDate)}{q.cents > 0 && q.dueDate < today && <span className="ml-1 text-[11px] font-semibold text-[color:var(--err)]">scaduta</span>}</td>
                  <td className="py-2 pr-2 text-right font-mono text-txt">{eur(cents(q.cents))}</td>
                  <td className="py-2 pl-2 text-[12px] text-dim">{q.postponable ? "Importo ≤ 250 €: il versamento è rinviabile alla scadenza successiva (verifica)." : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-faint">Date, codici tributo e soglia dei 250 € sono un promemoria: confermali sempre con il commercialista. Xenora non registra se il versamento è stato effettuato.</p>
      </Card>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm max-md:hidden">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-dim"><th className="px-3 py-2 font-semibold">Data</th><th className="px-3 py-2 font-semibold">Trim.</th><th className="px-3 py-2 font-semibold">Struttura</th><th className="px-3 py-2 font-semibold">Numero</th><th className="px-3 py-2 font-semibold">Cliente</th><th className="px-3 py-2 font-semibold">Stato</th><th className="px-3 py-2 text-right font-semibold">Bollo</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const st = STATO[r.stato] ?? { label: r.stato, color: "var(--dim)" };
              return (
                <tr key={r.id} onClick={() => router.push(`/documenti/${r.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                  <td className="px-3 py-2.5 text-dim">{r.issue_date ? fmtDate(r.issue_date) : "—"}</td>
                  <td className="px-3 py-2.5 text-dim">{quarterOf(r.issue_date)}º</td>
                  <td className="px-3 py-2.5 text-dim">{structName(r.structure_id)}</td>
                  <td className="px-3 py-2.5 font-mono text-txt">{r.number_label}</td>
                  <td className="px-3 py-2.5 text-dim">{cpName(r) || "—"}</td>
                  <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</span></td>
                  <td className="px-3 py-2.5 text-right font-mono text-txt">{eur(cents(r.bollo_cents))}</td>
                </tr>
              );
            })}
            {!loading && shown.length === 0 && <tr><td colSpan={7}><EmptyState title="Nessun bollo nel periodo" sub="Il bollo compare sui documenti emessi in regime forfettario oltre 77,47 €." /></td></tr>}
          </tbody>
          {shown.length > 0 && <tfoot><tr><td colSpan={6} className="px-3 py-2 text-right text-xs font-semibold text-dim">Totale periodo</td><td className="px-3 py-2 text-right font-mono font-bold text-txt">{eur(cents(shown.reduce((a, r) => a + r.bollo_cents, 0)))}</td></tr></tfoot>}
        </table>
      </div>

      {/* Telefono: una scheda per documento (la tabella serve da tablet in su) */}
      <div className="flex flex-col gap-2 md:hidden">
        {shown.map((r) => {
          const st = STATO[r.stato] ?? { label: r.stato, color: "var(--dim)" };
          return (
            <div key={r.id} onClick={() => router.push(`/documenti/${r.id}`)} className="cursor-pointer rounded-xl border border-line bg-surface p-3 shadow-sm active:bg-wash">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-txt">{cpName(r) || "—"}</div>
                  <div className="truncate text-xs text-dim"><span className="font-mono">{r.number_label}</span> · {r.issue_date ? fmtDate(r.issue_date) : "—"} · {quarterOf(r.issue_date)}º trim.</div>
                  <div className="truncate text-[11px] text-faint">{structName(r.structure_id)}</div>
                </div>
                <div className="shrink-0 text-right"><div className="font-mono text-sm font-semibold text-txt">{eur(cents(r.bollo_cents))}</div><span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</span></div>
              </div>
            </div>
          );
        })}
        {!loading && shown.length === 0 && <div className="rounded-xl border border-line bg-surface"><EmptyState title="Nessun bollo nel periodo" sub="Il bollo compare sui documenti emessi in regime forfettario oltre 77,47 €." /></div>}
        {shown.length > 0 && <div className="flex items-center justify-between rounded-xl border border-line bg-wash px-3 py-2 text-sm font-semibold"><span className="text-dim">Totale periodo</span><span className="font-mono text-txt">{eur(cents(shown.reduce((a, r) => a + r.bollo_cents, 0)))}</span></div>}
      </div>
    </div>
  );
}
