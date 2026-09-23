"use client";

// Registro bollo virtuale: riepilogo dei bolli (2€) sulle fatture emesse, per anno e trimestre.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, StatCard } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";

interface Row { id: string; number_label: string | null; issue_date: string | null; bollo_cents: number; counterpart: { name?: string } | null; structure_id: string | null }

export default function RegistroBolloPage() {
  const { activeStructureId } = useData();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.from("documents").select("id, number_label, issue_date, bollo_cents, counterpart, structure_id").gt("bollo_cents", 0).order("issue_date", { ascending: false })
      .then(({ data }) => { setRows((data ?? []) as Row[]); setLoading(false); });
  }, []);

  const scoped = useMemo(() => rows.filter((r) => activeStructureId === "all" || r.structure_id === activeStructureId), [rows, activeStructureId]);
  const years = useMemo(() => Array.from(new Set(scoped.map((r) => (r.issue_date ?? "").slice(0, 4)).filter(Boolean))).sort().reverse(), [scoped]);
  const ofYear = scoped.filter((r) => (r.issue_date ?? "").slice(0, 4) === String(year));
  const quarters = [1, 2, 3, 4].map((q) => {
    const list = ofYear.filter((r) => { const m = Number((r.issue_date ?? "").slice(5, 7)); return Math.ceil(m / 3) === q; });
    return { q, count: list.length, cents: list.reduce((a, r) => a + r.bollo_cents, 0) };
  });
  const totalYear = ofYear.reduce((a, r) => a + r.bollo_cents, 0);
  const cents = (c: number) => c / 100;
  const sel = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader title="Registro bollo virtuale" subtitle="Imposta di bollo (2€) sulle fatture — da versare all'Agenzia delle Entrate"
        actions={<select value={year} onChange={(e) => setYear(Number(e.target.value))} className={sel}>{[...new Set([String(year), ...years])].map((y) => <option key={y} value={y}>{y}</option>)}</select>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {quarters.map((q) => <StatCard key={q.q} label={`${q.q}º trimestre`} value={eur(cents(q.cents))} hint={`${q.count} doc.`} />)}
        <StatCard label={`Totale ${year}`} value={eur(cents(totalYear))} color="var(--focus)" hint={`${ofYear.length} doc.`} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="px-3 py-2 font-semibold">Data</th><th className="px-3 py-2 font-semibold">Numero</th><th className="px-3 py-2 font-semibold">Cliente</th><th className="px-3 py-2 text-right font-semibold">Bollo</th></tr></thead>
          <tbody>
            {ofYear.map((r) => <tr key={r.id} className="border-b border-line last:border-0"><td className="px-3 py-2.5 text-dim">{r.issue_date ? new Date(r.issue_date).toLocaleDateString("it-IT") : "—"}</td><td className="px-3 py-2.5 font-mono text-txt">{r.number_label}</td><td className="px-3 py-2.5 text-dim">{r.counterpart?.name ?? "—"}</td><td className="px-3 py-2.5 text-right font-mono text-txt">{eur(cents(r.bollo_cents))}</td></tr>)}
            {!loading && ofYear.length === 0 && <tr><td colSpan={4}><EmptyState title="Nessun bollo per quest'anno" sub="Il bollo compare sulle fatture in regime forfettario oltre 77,47 €." /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
