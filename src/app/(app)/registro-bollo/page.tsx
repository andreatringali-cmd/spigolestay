"use client";

// Registro bollo virtuale: riepilogo dei bolli (2€) sui documenti EMESSI, per anno e trimestre,
// con scadenze di versamento indicative. Le bozze non contano (il bollo esiste solo a documento emesso).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, StatCard, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";
import { STATO, DOC_KIND_LABEL } from "@/lib/invoicing/client";
import { bolloQuarters, quarterOf } from "@/lib/invoicing/bollo";
import { buildCsv, centsToCsv, downloadCsv } from "@/lib/invoicing/csv";
import { todayLocalISO } from "@/lib/invoicing/receivables";

interface Row { id: string; number_label: string | null; issue_date: string | null; bollo_cents: number; counterpart: { name?: string; lastName?: string } | null; structure_id: string | null; stato: string; doc_kind: string; regime: string | null }
const dmy = (iso: string) => iso.split("-").reverse().join("/");

export default function RegistroBolloPage() {
  const router = useRouter();
  const { activeStructureId, structures } = useData();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState<number | "all">("all");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.from("documents").select("id, number_label, issue_date, bollo_cents, counterpart, structure_id, stato, doc_kind, regime").gt("bollo_cents", 0).neq("stato", "bozza").order("issue_date", { ascending: false })
      .then(({ data, error }) => { if (error) setErr(error.message); setRows((data ?? []) as Row[]); setLoading(false); });
  }, []);

  const scoped = useMemo(() => rows.filter((r) => activeStructureId === "all" || r.structure_id === activeStructureId), [rows, activeStructureId]);
  const years = useMemo(() => Array.from(new Set(scoped.map((r) => (r.issue_date ?? "").slice(0, 4)).filter(Boolean))).sort().reverse(), [scoped]);
  const ofYear = scoped.filter((r) => (r.issue_date ?? "").slice(0, 4) === String(year));
  const shown = quarter === "all" ? ofYear : ofYear.filter((r) => quarterOf(r.issue_date) === quarter);
  const quarters = useMemo(() => bolloQuarters(scoped, year), [scoped, year]);
  const totalYear = ofYear.reduce((a, r) => a + r.bollo_cents, 0);
  const rejected = ofYear.filter((r) => r.stato === "scartata");
  const cents = (c: number) => c / 100;
  const today = todayLocalISO();
  const sel = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const structName = (id: string | null) => structures.find((s) => s.id === id)?.name ?? "—";
  const cpName = (r: Row) => `${r.counterpart?.name ?? ""} ${r.counterpart?.lastName ?? ""}`.trim();

  const exportCsv = () => {
    const head = ["Data", "Trimestre", "Struttura", "Tipo", "Numero", "Cliente", "Stato", "Bollo"];
    const lines = shown.map((r) => [r.issue_date ? dmy(r.issue_date) : "", `${quarterOf(r.issue_date)}º`, structName(r.structure_id), DOC_KIND_LABEL[r.doc_kind] ?? r.doc_kind, r.number_label ?? "", cpName(r), STATO[r.stato]?.label ?? r.stato, centsToCsv(r.bollo_cents)]);
    downloadCsv(`registro-bollo-${year}${quarter !== "all" ? `-T${quarter}` : ""}`, buildCsv(head, lines));
  };

  return (
    <div>
      <PageHeader title="Registro bollo virtuale" subtitle="Imposta di bollo (2€) sui documenti emessi — da versare all'Agenzia delle Entrate"
        actions={<div className="flex items-center gap-2">
          <select value={String(quarter)} onChange={(e) => setQuarter(e.target.value === "all" ? "all" : Number(e.target.value))} className={sel}><option value="all">Tutto l&apos;anno</option>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}º trimestre</option>)}</select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={sel}>{[...new Set([String(year), ...years])].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <button onClick={exportCsv} disabled={shown.length === 0} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">Esporta CSV</button>
        </div>} />

      {err && <Card className="mb-4"><p className="text-sm text-[color:var(--err)]">{err}</p></Card>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
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
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="py-1.5 pr-2 font-semibold">Trimestre</th><th className="py-1.5 pr-2 font-semibold">Codice tributo</th><th className="py-1.5 pr-2 font-semibold">Scadenza</th><th className="py-1.5 pr-2 text-right font-semibold">Importo</th><th className="py-1.5 pl-2 font-semibold">Nota</th></tr></thead>
            <tbody>
              {quarters.map((q) => (
                <tr key={q.q} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2 text-txt">{q.q}º</td>
                  <td className="py-2 pr-2 font-mono text-dim">{q.tributo}</td>
                  <td className="whitespace-nowrap py-2 pr-2 text-dim">{dmy(q.dueDate)}{q.cents > 0 && q.dueDate < today && <span className="ml-1 text-[10px] font-semibold text-[color:var(--err)]">scaduta</span>}</td>
                  <td className="py-2 pr-2 text-right font-mono text-txt">{eur(cents(q.cents))}</td>
                  <td className="py-2 pl-2 text-[12px] text-dim">{q.postponable ? "Importo ≤ 250 €: il versamento è rinviabile alla scadenza successiva (verifica)." : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-faint">Date, codici tributo e soglia dei 250 € sono un promemoria: confermali sempre con il commercialista. Xenora non registra se il versamento è stato effettuato.</p>
      </Card>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="px-3 py-2 font-semibold">Data</th><th className="px-3 py-2 font-semibold">Trim.</th><th className="px-3 py-2 font-semibold">Struttura</th><th className="px-3 py-2 font-semibold">Numero</th><th className="px-3 py-2 font-semibold">Cliente</th><th className="px-3 py-2 font-semibold">Stato</th><th className="px-3 py-2 text-right font-semibold">Bollo</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const st = STATO[r.stato] ?? { label: r.stato, color: "var(--dim)" };
              return (
                <tr key={r.id} onClick={() => router.push(`/documenti/${r.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                  <td className="px-3 py-2.5 text-dim">{r.issue_date ? new Date(r.issue_date).toLocaleDateString("it-IT") : "—"}</td>
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
    </div>
  );
}
