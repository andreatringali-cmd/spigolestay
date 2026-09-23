"use client";

import { useCallback, useEffect, useState } from "react";
import { apiPost } from "@/lib/invoicing/client";

interface Item { id: string; date: string | null; created_at: string; count: number; stato: string; esito: string | null; ricevuta: string | null; hasPdf: boolean }

// Archivio invii alla Questura: riscarica o stampa la ricevuta in qualsiasi momento.
export default function AlloggiatiArchiveModal({ sid, onClose }: { sid: string; onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div>
            <h2 className="text-base font-semibold text-txt">Archivio invii alla Questura</h2>
            <p className="text-[11px] text-faint">Ogni invio genera una ricevuta: puoi riscaricarla o stamparla in qualsiasi momento.</p>
          </div>
          <button onClick={onClose} aria-label="Chiudi" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-dim hover:bg-wash hover:text-txt">✕</button>
        </div>

        <div className="max-h-[64vh] overflow-y-auto p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-faint">Carico l'archivio…</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-faint">Nessun invio ancora. Le ricevute compaiono qui dopo aver inviato le schedine.</p>
          ) : (
            <div className="divide-y divide-line">
              {items.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-txt">
                      <span className="font-medium">{fmt(it.created_at)}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${okStato(it.stato) ? "var(--ok)" : "var(--err)"} 16%, transparent)`, color: okStato(it.stato) ? "var(--ok)" : "var(--err)" }}>{okStato(it.stato) ? "Inviato" : "Errore"}</span>
                    </div>
                    <div className="text-[11px] text-faint">{it.count} {it.count === 1 ? "schedina" : "schedine"}{it.esito ? ` · ${it.esito}` : ""}{it.hasPdf ? " · ricevuta salvata" : ""}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => download(it)} disabled={!!busy} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-50" title="Scarica la ricevuta PDF">{busy === it.id + "d" ? "…" : "⬇ Scarica"}</button>
                    <button onClick={() => print(it)} disabled={!!busy} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-50" title="Stampa la ricevuta">{busy === it.id + "p" ? "…" : "🖨 Stampa"}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {msg && <p className="mt-3 rounded-lg bg-wash px-3 py-2 text-xs font-medium text-dim">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
