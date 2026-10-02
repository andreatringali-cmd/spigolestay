"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card, StatCard } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";
import { centsEur, DOC_KIND_LABEL, STATO, apiPost } from "@/lib/invoicing/client";
import { buildCsv, centsToCsv, downloadCsv } from "@/lib/invoicing/csv";
import { computeResidui, todayLocalISO } from "@/lib/invoicing/receivables";

interface DocRow {
  id: string; structure_id: string | null; booking_code: string | null; doc_kind: string; regime: string | null;
  number_label: string | null; serie: string | null; stato: string; issue_date: string | null; due_date: string | null;
  counterpart: { name?: string; lastName?: string; vat?: string | null; tax_code?: string | null; country?: string } | null;
  taxable_cents: number; vat_cents: number; out_of_scope_cents: number; bollo_cents: number;
  total_cents: number; advance_cents: number; related_document_id: string | null; created_at: string;
}

const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const ISSUED = new Set(["emessa", "inviata_intermediario", "consegnata"]);
const dateOf = (r: DocRow) => (r.issue_date ?? r.created_at ?? "").slice(0, 10);
const cpName = (r: DocRow) => `${r.counterpart?.name ?? ""} ${r.counterpart?.lastName ?? ""}`.trim();

export default function DocumentiPage() {
  const router = useRouter();
  const { structures, activeStructureId } = useData();
  const [creating, setCreating] = useState(false);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [paid, setPaid] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [year, setYear] = useState<number | "all">(new Date().getFullYear());
  const [month, setMonth] = useState<number | "all">("all");
  const [kind, setKind] = useState<string>("all");
  const [stato, setStato] = useState<string>("all");

  const load = async () => {
    if (!supabase) { setErr("Devi essere connesso per vedere i documenti."); setLoading(false); return; }
    setLoading(true); setErr("");
    const [d, p] = await Promise.all([
      supabase.from("documents")
        .select("id, structure_id, booking_code, doc_kind, regime, number_label, serie, stato, issue_date, due_date, counterpart, taxable_cents, vat_cents, out_of_scope_cents, bollo_cents, total_cents, advance_cents, related_document_id, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("document_payments").select("document_id, amount_cents"),
    ]);
    if (d.error) setErr(d.error.message); else setRows((d.data ?? []) as DocRow[]);
    const m: Record<string, number> = {};
    for (const x of (p.data ?? []) as { document_id: string; amount_cents: number }[]) m[x.document_id] = (m[x.document_id] ?? 0) + x.amount_cents;
    setPaid(m);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const structName = (id: string | null) => structures.find((s) => s.id === id)?.name ?? "—";
  const residui = useMemo(() => computeResidui(rows, paid), [rows, paid]);
  // Residuo mostrato solo per fatture/ricevute emesse e non scartate; NC e bozze non sono crediti.
  const residuoOf = (r: DocRow): number | null => (r.doc_kind !== "nota_di_credito" && ISSUED.has(r.stato) ? Math.max(0, residui[r.id]?.residuo ?? 0) : null);

  // Anni: quelli presenti nei documenti + corrente.
  const years = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear()]);
    rows.forEach((r) => { const y = Number(dateOf(r).slice(0, 4)); if (y >= 2000) s.add(y); });
    return [...s].sort((a, b) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeStructureId !== "all" && r.structure_id !== activeStructureId) return false;
      const dt = dateOf(r);
      if (year !== "all" && dt.slice(0, 4) !== String(year)) return false;
      if (month !== "all" && Number(dt.slice(5, 7)) !== month) return false;
      if (kind !== "all" && r.doc_kind !== kind) return false;
      if (stato !== "all" && r.stato !== stato) return false;
      if (term) {
        const hay = `${r.number_label ?? ""} ${cpName(r)} ${r.booking_code ?? ""} ${r.counterpart?.vat ?? ""} ${r.counterpart?.tax_code ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, q, year, month, kind, stato, activeStructureId]);

  // Riepilogo del periodo filtrato: SOLO documenti fiscali emessi (fatture − note di credito); niente bozze, scartate, stornate, ricevute.
  const summary = useMemo(() => {
    let taxable = 0, vat = 0, out = 0, total = 0, bollo = 0, open = 0, nFatt = 0, nNc = 0, rejected = 0, drafts = 0;
    for (const r of filtered) {
      if (r.stato === "bozza") { drafts++; continue; }
      if (r.stato === "scartata") { rejected++; continue; }
      if (!ISSUED.has(r.stato) || r.doc_kind === "ricevuta_non_fiscale") continue;
      const sg = r.doc_kind === "nota_di_credito" ? -1 : 1;
      if (sg === 1) nFatt++; else nNc++;
      taxable += sg * r.taxable_cents; vat += sg * r.vat_cents; out += sg * r.out_of_scope_cents; total += sg * r.total_cents; bollo += sg * (r.bollo_cents ?? 0);
      if (sg === 1) open += Math.max(0, residui[r.id]?.residuo ?? 0);
    }
    return { taxable, vat, out, total, bollo, open, nFatt, nNc, rejected, drafts };
  }, [filtered, residui]);

  const exportCsv = () => {
    const head = ["Data", "Struttura", "Tipo", "Numero", "Stato", "Cliente", "P.IVA", "Codice fiscale", "Nazione", "Prenotazione", "Regime",
      "Imponibile", "IVA", "Fuori campo IVA", "Bollo", "Totale", "Incassato", "Stornato da NC", "Residuo", "Scadenza"];
    const lines = filtered.map((r) => {
      const sg = r.doc_kind === "nota_di_credito" ? -1 : 1; // le note di credito escono con segno negativo
      const x = residui[r.id];
      return [
        r.issue_date ? r.issue_date.split("-").reverse().join("/") : "", structName(r.structure_id), DOC_KIND_LABEL[r.doc_kind] ?? r.doc_kind,
        r.number_label ?? "", STATO[r.stato]?.label ?? r.stato, cpName(r), r.counterpart?.vat ?? "", r.counterpart?.tax_code ?? "", r.counterpart?.country ?? "",
        r.booking_code ?? "", r.regime ?? "",
        centsToCsv(sg * r.taxable_cents), centsToCsv(sg * r.vat_cents), centsToCsv(sg * r.out_of_scope_cents), centsToCsv(sg * (r.bollo_cents ?? 0)), centsToCsv(sg * r.total_cents),
        sg === 1 ? centsToCsv(x?.paid ?? 0) : "", sg === 1 ? centsToCsv(x?.credited ?? 0) : "",
        residuoOf(r) === null ? "" : centsToCsv(residuoOf(r)), r.due_date ? r.due_date.split("-").reverse().join("/") : "",
      ];
    });
    downloadCsv(`documenti-${year}${month !== "all" ? `-${String(month).padStart(2, "0")}` : ""}`, buildCsv(head, lines));
  };

  const selCls = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const today = todayLocalISO();

  // Nuovo documento VUOTO: la prenotazione si collega dopo dalla scheda.
  const createNew = async () => {
    // Con "Tutte" non indovino la struttura: se ce n'è più di una chiedo di sceglierla in alto a destra.
    const structureId = activeStructureId !== "all" ? activeStructureId : structures.length === 1 ? structures[0].id : undefined;
    if (!structureId) { setErr("Seleziona prima una struttura in alto a destra per creare un nuovo documento."); return; }
    setCreating(true); setErr("");
    try {
      const r = await apiPost<{ documentId: string }>("invoicing/new", { structureId });
      router.push(`/documenti/${r.documentId}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore"); setCreating(false); }
  };

  return (
    <div>
      <PageHeader title="Documenti fiscali" subtitle="Fatture, note di credito e ricevute — con stato SDI" />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Cerca numero, cliente, P.IVA, CF, prenotazione…" />
          <select value={String(year)} onChange={(e) => setYear(e.target.value === "all" ? "all" : Number(e.target.value))} className={selCls}>
            <option value="all">Tutti gli anni</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={String(month)} onChange={(e) => setMonth(e.target.value === "all" ? "all" : Number(e.target.value))} className={selCls}>
            <option value="all">Tutti i mesi</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
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
            <button onClick={exportCsv} title="CSV per Excel/commercialista (separatore ; e decimali con virgola; le note di credito con segno negativo)" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">Esporta CSV</button>
            <button onClick={createNew} disabled={creating} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{creating ? "Creo…" : "+ Nuovo documento"}</button>
          </div>
        </div>
      </Card>

      {err && <Card className="mb-4"><p className="text-sm text-[color:var(--err)]">{err}</p></Card>}

      {!loading && (
        <div className="mb-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Imponibile (netto NC)" value={eur(centsEur(summary.taxable))} hint={`${summary.nFatt} fatture · ${summary.nNc} NC`} />
            <StatCard label="IVA (netto NC)" value={eur(centsEur(summary.vat))} />
            <StatCard label="Tassa sogg. (fuori campo)" value={eur(centsEur(summary.out))} />
            <StatCard label="Totale (netto NC)" value={eur(centsEur(summary.total))} color="var(--focus)" hint={summary.bollo ? `di cui bollo ${eur(centsEur(summary.bollo))}` : undefined} />
            <StatCard label="Da incassare" value={eur(centsEur(summary.open))} color={summary.open > 0 ? "var(--warn)" : "var(--ok)"} onClick={() => router.push("/scadenzario-incassi")} hint="vai allo scadenzario" />
          </div>
          <p className="mt-1.5 text-[11px] text-faint">
            Riepilogo dei soli documenti emessi nel filtro attivo: fatture meno note di credito; escluse ricevute{summary.drafts ? `, ${summary.drafts} bozze` : ""}{summary.rejected ? <> e <button onClick={() => setStato("scartata")} className="font-semibold text-[color:var(--err)] hover:underline">{summary.rejected} scartate dallo SdI (da correggere)</button></> : ""}.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[960px] text-sm">
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
              const res = residuoOf(r);
              const late = res !== null && res > 0 && !!r.due_date && r.due_date < today;
              const isNc = r.doc_kind === "nota_di_credito";
              return (
                <tr key={r.id} onClick={() => router.push(`/documenti/${r.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                  <td className="whitespace-nowrap px-3 py-2.5 text-dim">{r.issue_date ? new Date(r.issue_date).toLocaleDateString("it-IT") : <span className="text-faint">bozza</span>}</td>
                  <td className="px-3 py-2.5 text-dim">{structName(r.structure_id)}</td>
                  <td className="px-3 py-2.5 text-dim">{DOC_KIND_LABEL[r.doc_kind] ?? r.doc_kind}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-txt">{r.number_label ?? "—"}</td>
                  <td className="px-3 py-2.5"><div className="font-medium text-txt">{cpName(r) || "—"}</div>{r.booking_code && <div className="text-[11px] text-faint">{r.booking_code}</div>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-txt">{isNc ? "−" : ""}{eur(centsEur(r.taxable_cents))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{isNc ? "−" : ""}{eur(centsEur(r.vat_cents))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{r.out_of_scope_cents ? `${isNc ? "−" : ""}${eur(centsEur(r.out_of_scope_cents))}` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-txt">{isNc ? "−" : ""}{eur(centsEur(r.total_cents))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono" style={{ color: late ? "var(--err)" : "var(--dim)" }}>{res === null ? "—" : res === 0 ? "saldato" : eur(centsEur(res))}</td>
                  <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</span></td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && <tr><td colSpan={11}><EmptyState title="Nessun documento" sub="Nessun risultato con questi filtri. Crea il primo con “+ Nuovo documento” o dalla scheda di una prenotazione." /></td></tr>}
            {loading && <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-faint">Caricamento…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
