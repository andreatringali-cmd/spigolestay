"use client";

import { fmtDate, fmtDateTime } from "@/lib/dates";
import { ymdRome } from "@/lib/dates-rome";
import DateField from "@/components/DateField";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { PageHeader, Card } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { apiPost } from "@/lib/invoicing/client";

interface Item { id: string; day: string | null; created_at: string; count: number; stato: string; esito: string | null }

// Pagina dedicata: archivio invii ISTAT (storico delle chiusure giornaliere all'Osservatorio).
export default function IstatArchivioPage() {
  const { structures, activeStructureId } = useData();
  const [sid, setSid] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const target = activeStructureId !== "all" && structures.some((x) => x.id === activeStructureId) ? activeStructureId : structures[0]?.id ?? "";
    if (target && target !== sid) setSid(target);
  }, [structures, activeStructureId, sid]);

  const load = useCallback(async () => {
    if (!sid) return;
    setLoading(true); setMsg("");
    try { const r = await apiPost<{ items: Item[] }>("istat/submissions", { structureId: sid }); setItems(r.items ?? []); }
    catch (e) { setItems([]); setMsg(e instanceof Error ? e.message : "Impossibile caricare l'archivio."); } finally { setLoading(false); }
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const fmt = (iso: string) => fmtDateTime(iso);
  const fmtDay = (d: string | null) => (d ? fmtDate(d) : "—");
  const okStato = (s: string) => s === "sent";
  const shown = items.filter((it) => {
    const d = (it.day || ymdRome(it.created_at));
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  const fieldCls = "rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader title="Archivio invii ISTAT" subtitle={`Storico delle chiusure giornaliere inviate all'Osservatorio Turistico · Struttura: ${structures.find((x) => x.id === sid)?.name ?? "—"}`}
        actions={<Link href="/istat" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">← Torna al movimento</Link>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        {structures.length > 1 && activeStructureId === "all" && <select value={sid} onChange={(e) => setSid(e.target.value)} className={fieldCls}>{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        <span className="text-[11px] font-medium text-dim">Dal</span>
        <DateField value={from} onChange={(v) => setFrom(v)} className={fieldCls} />
        <span className="text-[11px] font-medium text-dim">Al</span>
        <DateField value={to} onChange={(v) => setTo(v)} className={fieldCls} />
        {(from || to) && <button onClick={() => { setFrom(""); setTo(""); }} className={`${fieldCls} text-dim hover:bg-wash`}>Azzera filtri</button>}
        <span className="ml-auto text-[11px] text-faint">{shown.length} {shown.length === 1 ? "chiusura" : "chiusure"}</span>
      </div>

      <Card>
        {loading ? (
          <p className="py-10 text-center text-sm text-faint">Carico l'archivio…</p>
        ) : shown.length === 0 ? (
          <EmptyState title="Nessun invio" sub="Le chiusure compaiono qui dopo aver premuto «Chiudi giornata»." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3">Giornata</th>
                  <th className="py-2 pr-3">Movimenti</th>
                  <th className="py-2 pr-3">Stato</th>
                  <th className="py-2 pr-3">Inviato il</th>
                  <th className="py-2 pr-3">Esito</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((it) => (
                  <tr key={it.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-txt">{fmtDay(it.day)}</td>
                    <td className="py-2.5 pr-3 text-dim">{it.count}</td>
                    <td className="py-2.5 pr-3"><span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${okStato(it.stato) ? "var(--ok)" : "var(--err)"} 16%, transparent)`, color: okStato(it.stato) ? "var(--ok)" : "var(--err)" }}>{okStato(it.stato) ? "Inviato" : "Errore"}</span></td>
                    <td className="py-2.5 pr-3 text-[12px] text-faint">{fmt(it.created_at)}</td>
                    <td className="py-2.5 pr-3 text-[12px] text-faint">{it.esito || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {msg && <p className="mt-3 rounded-lg bg-wash px-3 py-2 text-xs font-medium text-dim">{msg}</p>}
      </Card>
    </div>
  );
}
