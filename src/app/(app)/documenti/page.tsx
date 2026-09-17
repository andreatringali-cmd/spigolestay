"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";
import { centsEur, DOC_KIND_LABEL, STATO, apiPost } from "@/lib/invoicing/client";

interface DocRow {
  id: string; structure_id: string | null; booking_code: string | null; doc_kind: string;
  number_label: string | null; serie: string | null; stato: string; issue_date: string | null;
  counterpart: { name?: string } | null; taxable_cents: number; vat_cents: number;
  out_of_scope_cents: number; total_cents: number; advance_cents: number; created_at: string;
}

const YEARS = (() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2]; })();

export default function DocumentiPage() {
  const router = useRouter();
  const { structures, activeStructureId } = useData();
  const [creating, setCreating] = useState(false);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [year, setYear] = useState<number | "all">(new Date().getFullYear());
  const [kind, setKind] = useState<string>("all");
  const [stato, setStato] = useState<string>("all");

  const load = async () => {
    if (!supabase) { setErr("Devi essere connesso per vedere i documenti."); setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.from("documents")
      .select("id, structure_id, booking_code, doc_kind, number_label, serie, stato, issue_date, counterpart, taxable_cents, vat_cents, out_of_scope_cents, total_cents, advance_cents, created_at")
      .order("created_at", { ascending: false });
    if (error) setErr(error.message); else setRows((data ?? []) as DocRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const structName = (id: string | null) => structures.find((s) => s.id === id)?.name ?? "—";

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeStructureId !== "all" && r.structure_id !== activeStructureId) return false;
      if (year !== "all") { const y = (r.issue_date ?? r.created_at ?? "").slice(0, 4); if (y !== String(year)) return false; }
      if (kind !== "all" && r.doc_kind !== kind) return false;
      if (stato !== "all" && r.stato !== stato) return false;
      if (term) {
        const hay = `${r.number_label ?? ""} ${r.counterpart?.name ?? ""} ${r.booking_code ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, q, year, kind, stato, activeStructureId]);

  const exportCsv = () => {
    const head = ["Data", "Struttura", "Tipo", "Numero", "Cliente", "Prenotazione", "Imponibile", "IVA", "Tassa soggiorno", "Totale", "Da incassare", "Stato"];
    const lines = filtered.map((r) => [
      r.issue_date ?? "", structName(r.structure_id), DOC_KIND_LABEL[r.doc_kind] ?? r.doc_kind,
      r.number_label ?? "", r.counterpart?.name ?? "", r.booking_code ?? "",
      centsEur(r.taxable_cents).toFixed(2), centsEur(r.vat_cents).toFixed(2), centsEur(r.out_of_scope_cents).toFixed(2),
      centsEur(r.total_cents).toFixed(2), centsEur(r.total_cents - r.advance_cents).toFixed(2), STATO[r.stato]?.label ?? r.stato,
    ].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","));
    const csv = [head.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `documenti-${year}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const selCls = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  // Nuovo documento VUOTO: la prenotazione si collega dopo dalla scheda.
  const createNew = async () => {
    setCreating(true);
    try {
      const structureId = activeStructureId !== "all" ? activeStructureId : structures[0]?.id;
      const r = await apiPost<{ documentId: string }>("invoicing/new", { structureId });
      router.push(`/documenti/${r.documentId}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore"); setCreating(false); }
  };

  return (
    <div>
      <PageHeader title="Documenti fiscali" subtitle="Fatture, note di credito e ricevute — con stato SDI" />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Cerca numero, cliente, prenotazione…" />
          <select value={String(year)} onChange={(e) => setYear(e.target.value === "all" ? "all" : Number(e.target.value))} className={selCls}>
            <option value="all">Tutti gli anni</option>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={selCls}>
            <option value="all">Tutti i tipi</option>
            <option value="fattura">Fatture</option>
            <option value="nota_di_credito">Note di credito</option>
            <option value="ricevuta_non_fiscale">Ricevute</option>
          </select>
          <select value={stato} onChange={(e) => setStato(e.target.value)} className={selCls}>
            <option value="all">Tutti gli stati</option>
            {Object.entries(STATO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => router.push("/impostazioni-fattura")} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">Impostazioni</button>
            <button onClick={exportCsv} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">Esporta CSV</button>
            <button onClick={createNew} disabled={creating} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{creating ? "Creo…" : "+ Nuovo documento"}</button>
          </div>
        </div>
      </Card>

      {err && <Card className="mb-4"><p className="text-sm text-[color:var(--err)]">{err}</p></Card>}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-3 py-2 font-semibold">Data</th>
              <th className="px-3 py-2 font-semibold">Struttura</th>
              <th className="px-3 py-2 font-semibold">Tipo</th>
              <th className="px-3 py-2 font-semibold">Numero</th>
              <th className="px-3 py-2 font-semibold">Cliente</th>
              <th className="px-3 py-2 text-right font-semibold">Imponibile</th>
              <th className="px-3 py-2 text-right font-semibold">IVA</th>
              <th className="px-3 py-2 text-right font-semibold">Tassa sogg.</th>
              <th className="px-3 py-2 text-right font-semibold">Totale</th>
              <th className="px-3 py-2 text-right font-semibold">Da incassare</th>
              <th className="px-3 py-2 font-semibold">Stato</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const st = STATO[r.stato] ?? { label: r.stato, color: "var(--dim)" };
              return (
                <tr key={r.id} onClick={() => router.push(`/documenti/${r.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                  <td className="whitespace-nowrap px-3 py-2.5 text-dim">{r.issue_date ? new Date(r.issue_date).toLocaleDateString("it-IT") : <span className="text-faint">bozza</span>}</td>
                  <td className="px-3 py-2.5 text-dim">{structName(r.structure_id)}</td>
                  <td className="px-3 py-2.5 text-dim">{DOC_KIND_LABEL[r.doc_kind] ?? r.doc_kind}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-txt">{r.number_label ?? "—"}</td>
                  <td className="px-3 py-2.5"><div className="font-medium text-txt">{r.counterpart?.name ?? "—"}</div>{r.booking_code && <div className="text-[11px] text-faint">{r.booking_code}</div>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-txt">{eur(centsEur(r.taxable_cents))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{eur(centsEur(r.vat_cents))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{r.out_of_scope_cents ? eur(centsEur(r.out_of_scope_cents)) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(centsEur(r.total_cents))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{eur(centsEur(r.total_cents - r.advance_cents))}</td>
                  <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</span></td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && <tr><td colSpan={11}><EmptyState title="Nessun documento" sub="Crea il primo con “+ Nuovo documento” o dalla scheda di una prenotazione." /></td></tr>}
            {loading && <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-faint">Caricamento…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
