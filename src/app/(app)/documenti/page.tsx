"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card } from "@/components/ui";
import { eur } from "@/lib/format";
import { nights } from "@/lib/dates";
import { centsEur, DOC_KIND_LABEL, STATO, invPost } from "@/lib/invoicing/client";

interface DocRow {
  id: string; structure_id: string | null; booking_code: string | null; doc_kind: string;
  number_label: string | null; serie: string | null; stato: string; issue_date: string | null;
  counterpart: { name?: string } | null; taxable_cents: number; vat_cents: number;
  out_of_scope_cents: number; total_cents: number; advance_cents: number; created_at: string;
}

const YEARS = (() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2]; })();

export default function DocumentiPage() {
  const router = useRouter();
  const { structures, bookings, getGuest } = useData();
  const [picker, setPicker] = useState(false);
  const [pq, setPq] = useState("");
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
      if (year !== "all") { const y = (r.issue_date ?? r.created_at ?? "").slice(0, 4); if (y !== String(year)) return false; }
      if (kind !== "all" && r.doc_kind !== kind) return false;
      if (stato !== "all" && r.stato !== stato) return false;
      if (term) {
        const hay = `${r.number_label ?? ""} ${r.counterpart?.name ?? ""} ${r.booking_code ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, q, year, kind, stato]);

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

  // "Nuovo documento": si emette da una prenotazione (il folio alimenta le righe).
  const pickList = useMemo(() => {
    const term = pq.trim().toLowerCase();
    return [...bookings]
      .filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (b.total ?? 0) > 0)
      .sort((a, b) => (b.checkIn || "").localeCompare(a.checkIn || ""))
      .filter((b) => { if (!term) return true; const g = getGuest(b.guestId)?.fullName ?? ""; return `${g} ${b.code ?? ""}`.toLowerCase().includes(term); })
      .slice(0, 40);
  }, [bookings, pq, getGuest]);

  const createFrom = async (bookingId: string) => {
    setCreating(true);
    try { const r = await invPost<{ documentId: string }>("create", { bookingId }); router.push(`/documenti/${r.documentId}`); }
    catch (e) { setErr(e instanceof Error ? e.message : "Errore"); setCreating(false); setPicker(false); }
  };

  return (
    <div>
      <PageHeader title="Documenti fiscali" subtitle="Fatture, note di credito e ricevute — con stato SDI"
        actions={<div className="flex items-center gap-2">
          <button onClick={() => router.push("/impostazioni-fattura")} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">Impostazioni</button>
          <button onClick={exportCsv} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">Esporta CSV</button>
          <button onClick={() => { setPq(""); setPicker(true); }} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">+ Nuovo documento</button>
        </div>} />

      {picker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setPicker(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-2 flex items-center justify-between"><span className="text-lg font-bold text-txt">Nuovo documento da prenotazione</span><button onClick={() => setPicker(false)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Cerca ospite o codice…" className={`${selCls} mb-2`} autoFocus />
            <div className="flex-1 overflow-y-auto">
              {pickList.map((b) => {
                const g = getGuest(b.guestId);
                return (
                  <button key={b.id} disabled={creating} onClick={() => createFrom(b.id)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left hover:border-focus hover:bg-wash disabled:opacity-50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-txt">{g?.fullName || "Ospite"} <span className="text-faint">· {b.code}</span></div>
                      <div className="text-[11px] text-faint">{structName(b.structureId)} · {new Date(b.checkIn).toLocaleDateString("it-IT")}–{new Date(b.checkOut).toLocaleDateString("it-IT")} · {nights(b.checkIn, b.checkOut)} notti</div>
                    </div>
                    <span className="shrink-0 font-mono text-sm text-txt">{eur(b.total ?? 0)}</span>
                  </button>
                );
              })}
              {pickList.length === 0 && <p className="py-6 text-center text-sm text-faint">Nessuna prenotazione trovata.</p>}
            </div>
            <p className="mt-2 text-[11px] text-faint">Il documento nasce come bozza dal folio della prenotazione: righe, IVA, acconti e bollo precompilati.</p>
          </div>
        </div>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca numero, cliente, prenotazione…" className={`${selCls} min-w-0 flex-1`} />
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
            {!loading && filtered.length === 0 && <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-faint">Nessun documento. Emetti il primo dalla scheda di una prenotazione.</td></tr>}
            {loading && <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-faint">Caricamento…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
