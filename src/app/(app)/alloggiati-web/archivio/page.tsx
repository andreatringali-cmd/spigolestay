"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { PageHeader, Card } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { apiPost } from "@/lib/invoicing/client";

interface Item { id: string; date: string | null; created_at: string; count: number; stato: string; esito: string | null; ricevuta: string | null; hasPdf: boolean }

// Pagina dedicata: archivio invii alla Questura (ricevute scaricabili/stampabili in qualsiasi momento).
export default function AlloggiatiArchivioPage() {
  const { structures, activeStructureId } = useData();
  const [sid, setSid] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stato, setStato] = useState("all");

  useEffect(() => {
    const target = activeStructureId !== "all" && structures.some((x) => x.id === activeStructureId) ? activeStructureId : structures[0]?.id ?? "";
    if (target && target !== sid) setSid(target);
  }, [structures, activeStructureId, sid]);

  const load = useCallback(async () => {
    if (!sid) return;
    setLoading(true);
    try { const r = await apiPost<{ items: Item[] }>("alloggiati/submissions", { structureId: sid, action: "list" }); setItems(r.items ?? []); }
    catch { setItems([]); } finally { setLoading(false); }
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const b64ToBlobUrl = (b64: string) => {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
  };
  const getPdf = async (it: Item): Promise<string | null> => {
    try { const r = await apiPost<{ ok: boolean; message?: string; pdfBase64?: string }>("alloggiati/submissions", { structureId: sid, action: "ricevuta", submissionId: it.id }); if (r.pdfBase64) return r.pdfBase64; setMsg(r.message || "Ricevuta non disponibile."); return null; }
    catch (e) { setMsg(e instanceof Error ? e.message : "Errore ricevuta."); return null; }
  };
  const download = async (it: Item) => {
    setBusy(it.id + "d"); setMsg("");
    const b64 = await getPdf(it);
    if (b64) { const url = b64ToBlobUrl(b64); const a = document.createElement("a"); a.href = url; a.download = `ricevuta-alloggiati-${it.created_at.slice(0, 10)}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); load(); }
    setBusy("");
  };
  const print = async (it: Item) => {
    setBusy(it.id + "p"); setMsg("");
    const b64 = await getPdf(it);
    if (b64) {
      const url = b64ToBlobUrl(b64);
      const ifr = document.createElement("iframe"); ifr.style.position = "fixed"; ifr.style.right = "0"; ifr.style.bottom = "0"; ifr.style.width = "0"; ifr.style.height = "0"; ifr.style.border = "0";
      ifr.src = url; document.body.appendChild(ifr);
      ifr.onload = () => { try { ifr.contentWindow?.focus(); ifr.contentWindow?.print(); } catch { window.open(url, "_blank"); } setTimeout(() => { ifr.remove(); URL.revokeObjectURL(url); }, 60000); };
      load();
    }
    setBusy("");
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const okStato = (s: string) => s === "sent";
  const shown = items.filter((it) => {
    const d = it.created_at.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (stato === "sent" && !okStato(it.stato)) return false;
    if (stato === "error" && okStato(it.stato)) return false;
    return true;
  });
  const fieldCls = "rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader title="Archivio ricevute · Questura" subtitle="Storico degli invii alla Questura: riscarica o stampa la ricevuta in qualsiasi momento"
        actions={<Link href="/alloggiati-web" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">← Torna alle schedine</Link>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        {structures.length > 1 && <select value={sid} onChange={(e) => setSid(e.target.value)} className={fieldCls}>{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        <span className="text-[11px] font-medium text-dim">Dal</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldCls} />
        <span className="text-[11px] font-medium text-dim">Al</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldCls} />
        <select value={stato} onChange={(e) => setStato(e.target.value)} className={fieldCls}>
          <option value="all">Tutti gli stati</option>
          <option value="sent">Inviati</option>
          <option value="error">Con errori</option>
        </select>
        {(from || to || stato !== "all") && <button onClick={() => { setFrom(""); setTo(""); setStato("all"); }} className={`${fieldCls} text-dim hover:bg-wash`}>Azzera filtri</button>}
        <span className="ml-auto text-[11px] text-faint">{shown.length} {shown.length === 1 ? "invio" : "invii"}</span>
      </div>

      <Card>
        {loading ? (
          <p className="py-10 text-center text-sm text-faint">Carico l'archivio…</p>
        ) : shown.length === 0 ? (
          <EmptyState title="Nessun invio" sub="Le ricevute compaiono qui dopo aver inviato le schedine alla Questura." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3">Data e ora invio</th>
                  <th className="py-2 pr-3">Schedine</th>
                  <th className="py-2 pr-3">Stato</th>
                  <th className="py-2 pr-3">Esito</th>
                  <th className="py-2 pr-3 text-right">Ricevuta</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((it) => (
                  <tr key={it.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-txt">{fmt(it.created_at)}</td>
                    <td className="py-2.5 pr-3 text-dim">{it.count}</td>
                    <td className="py-2.5 pr-3"><span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${okStato(it.stato) ? "var(--ok)" : "var(--err)"} 16%, transparent)`, color: okStato(it.stato) ? "var(--ok)" : "var(--err)" }}>{okStato(it.stato) ? "Inviato" : "Errore"}</span></td>
                    <td className="py-2.5 pr-3 text-[12px] text-faint">{it.esito || "—"}{it.hasPdf ? " · ricevuta salvata" : ""}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => download(it)} disabled={!!busy} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-50" title="Scarica la ricevuta PDF">{busy === it.id + "d" ? "…" : "⬇ Scarica"}</button>
                        <button onClick={() => print(it)} disabled={!!busy} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-50" title="Stampa la ricevuta">{busy === it.id + "p" ? "…" : "🖨 Stampa"}</button>
                      </div>
                    </td>
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
