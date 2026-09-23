"use client";

// Scadenzario incassi: documenti emessi non (del tutto) incassati, per scadenza.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, StatCard } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { eur } from "@/lib/format";

interface Doc { id: string; number_label: string | null; issue_date: string | null; due_date: string | null; total_cents: number; counterpart: { name?: string } | null; booking_code: string | null; structure_id: string | null }

export default function ScadenzarioIncassiPage() {
  const router = useRouter();
  const { activeStructureId } = useData();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [paid, setPaid] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("all"); // all | overdue | open(=non scaduti)

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    (async () => {
      const [d, p] = await Promise.all([
        supabase.from("documents").select("id, number_label, issue_date, due_date, total_cents, counterpart, booking_code, structure_id").in("stato", ["emessa", "inviata_intermediario", "consegnata"]),
        supabase.from("document_payments").select("document_id, amount_cents"),
      ]);
      setDocs((d.data ?? []) as Doc[]);
      const m: Record<string, number> = {}; for (const x of (p.data ?? []) as { document_id: string; amount_cents: number }[]) m[x.document_id] = (m[x.document_id] ?? 0) + x.amount_cents;
      setPaid(m); setLoading(false);
    })();
  }, []);

  const t = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => docs.map((d) => ({ ...d, residuo: d.total_cents - (paid[d.id] ?? 0), overdue: !!(d.due_date && d.due_date < t) }))
    .filter((r) => r.residuo > 0)
    .filter((r) => activeStructureId === "all" || r.structure_id === activeStructureId)
    .filter((r) => scope === "overdue" ? r.overdue : scope === "open" ? !r.overdue : true)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")), [docs, paid, scope, t, activeStructureId]);
  const totalOpen = rows.reduce((a, r) => a + r.residuo, 0);
  const overdueTot = rows.filter((r) => r.overdue).reduce((a, r) => a + r.residuo, 0);
  const cents = (c: number) => c / 100;
  const sel = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader title="Scadenzario incassi" subtitle="Documenti emessi ancora da incassare, per scadenza"
        actions={<select value={scope} onChange={(e) => setScope(e.target.value)} className={sel}><option value="all">Tutti da incassare</option><option value="overdue">Solo scaduti</option><option value="open">Non ancora scaduti</option></select>} />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label="Totale da incassare" value={eur(cents(totalOpen))} />
        <StatCard label="Di cui scaduto" value={eur(cents(overdueTot))} color={overdueTot > 0 ? "var(--err)" : "var(--ok)"} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="px-3 py-2 font-semibold">Scadenza</th><th className="px-3 py-2 font-semibold">Numero</th><th className="px-3 py-2 font-semibold">Cliente</th><th className="px-3 py-2 text-right font-semibold">Totale</th><th className="px-3 py-2 text-right font-semibold">Residuo</th><th className="px-3 py-2 font-semibold">Stato</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/documenti/${r.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                <td className="whitespace-nowrap px-3 py-2.5 text-xs" style={{ color: r.overdue ? "var(--err)" : "var(--dim)" }}>{r.due_date ? new Date(r.due_date).toLocaleDateString("it-IT") : "—"}</td>
                <td className="px-3 py-2.5 font-mono text-txt">{r.number_label}</td>
                <td className="px-3 py-2.5"><div className="text-txt">{r.counterpart?.name ?? "—"}</div>{r.booking_code && <div className="text-[11px] text-faint">{r.booking_code}</div>}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{eur(cents(r.total_cents))}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(cents(r.residuo))}</td>
                <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${r.overdue ? "var(--err)" : "var(--warn)"} 16%, transparent)`, color: r.overdue ? "var(--err)" : "var(--warn)" }}>{r.overdue ? "Scaduto" : "Da incassare"}</span></td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={6}><EmptyState title="Nessun incasso in sospeso" sub="Tutti i documenti emessi risultano saldati." /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
