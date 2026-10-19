"use client";

// Anagrafica Clienti / Agenzie (intestatari riutilizzabili per la fatturazione).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { PageHeader, Card } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmProvider";
import { apiPost } from "@/lib/invoicing/client";
import { useTenantId } from "@/lib/tenant";

interface CP { id: string; kind: string; name: string; vat: string | null; tax_code: string | null; address: string | null; city: string | null; cap: string | null; province: string | null; country: string | null; sdi_code: string | null; pec: string | null; email: string | null }
const KIND: Record<string, string> = { privato: "Privato", societa: "Società", estero: "Estero", ota: "OTA / Agenzia" };
interface SyncItem { id: string; name: string; kind: string; vat: string | null; tax_code: string | null; city: string | null }
interface SyncPreview { xenoraTotal: number; ficTotal: number; aligned: number; duplicates: number; truncated: boolean; toSend: SyncItem[]; toImport: SyncItem[] }
const emptyForm = () => ({ id: "", kind: "societa", name: "", vat: "", tax_code: "", address: "", city: "", cap: "", province: "", country: "IT", sdi_code: "", pec: "", email: "" });

export default function AnagraficaClientiPage() {
  const { user } = useAuth();
  const tenantId = useTenantId(); // account di lavoro: per un collaboratore è quello di chi lo ha invitato
  const ask = useConfirm();
  const [list, setList] = useState<CP[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [edit, setEdit] = useState<ReturnType<typeof emptyForm> | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(""); // errore di salvataggio mostrato nel pannello
  // Sincronizzazione con Fatture in Cloud (visibile solo se è il provider fatture ed è collegato).
  const [ficOn, setFicOn] = useState(false);
  const [sync, setSync] = useState<{ open: boolean; busy: boolean; msg: string; prev: SyncPreview | null; send: Set<string>; imp: Set<string> }>({ open: false, busy: false, msg: "", prev: null, send: new Set(), imp: new Set() });

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data } = await supabase.from("counterparts").select("*").order("name");
    setList((data ?? []) as CP[]); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("tenant_invoice_settings").select("default_provider").maybeSingle().then(({ data }) => {
      if (data?.default_provider !== "fattureincloud") return;
      apiPost<{ connected: boolean }>("invoicing/provider", { provider: "fattureincloud", action: "status" }).then((r) => setFicOn(!!r.connected)).catch(() => {});
    });
  }, [user]);

  const openSync = async () => {
    setSync({ open: true, busy: true, msg: "", prev: null, send: new Set(), imp: new Set() });
    try {
      const p = await apiPost<SyncPreview>("invoicing/fic/clients", { action: "preview" });
      setSync({ open: true, busy: false, msg: "", prev: p, send: new Set(p.toSend.map((x) => x.id)), imp: new Set(p.toImport.map((x) => x.id)) });
    } catch (e) { setSync((p) => ({ ...p, busy: false, msg: (e as Error).message })); }
  };
  const toggle = (which: "send" | "imp", id: string) => setSync((p) => { const n = new Set(p[which]); if (n.has(id)) n.delete(id); else n.add(id); return { ...p, [which]: n }; });
  const applySync = async () => {
    setSync((p) => ({ ...p, busy: true, msg: "" }));
    try {
      const r = await apiPost<{ created: number; imported: number; errors: string[]; remaining: number }>("invoicing/fic/clients", { action: "sync", sendIds: [...sync.send], importIds: [...sync.imp] });
      const parts = [`Creati su Fatture in Cloud: ${r.created}`, `importati in Xenora: ${r.imported}`];
      if (r.remaining > 0) parts.push(`ne restano ${r.remaining}: ripeti la sincronizzazione`);
      if (r.errors.length) parts.push(`Errori: ${r.errors.slice(0, 3).join(" · ")}`);
      setSync((p) => ({ ...p, busy: false, prev: null, msg: parts.join(" — ") }));
      load();
    } catch (e) { setSync((p) => ({ ...p, busy: false, msg: (e as Error).message })); }
  };

  const filtered = useMemo(() => list.filter((c) => (kind === "all" || c.kind === kind) && (!q.trim() || `${c.name} ${c.vat ?? ""} ${c.tax_code ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [list, q, kind]);

  const openEdit = (c: CP) => { setErr(""); setEdit({ id: c.id, kind: c.kind, name: c.name, vat: c.vat ?? "", tax_code: c.tax_code ?? "", address: c.address ?? "", city: c.city ?? "", cap: c.cap ?? "", province: c.province ?? "", country: c.country ?? "IT", sdi_code: c.sdi_code ?? "", pec: c.pec ?? "", email: c.email ?? "" }); };
  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { setErr(edit.kind === "privato" ? "Inserisci nome e cognome." : "Inserisci la ragione sociale."); return; }
    if (!supabase || !user) { setErr("Salvataggio non disponibile: accedi con il tuo account."); return; }
    setErr(""); setSaving(true);
    const row = { tenant_id: tenantId ?? user.id, kind: edit.kind, name: edit.name.trim(), vat: edit.vat || null, tax_code: edit.tax_code || null, address: edit.address || null, city: edit.city || null, cap: edit.cap || null, province: edit.province || null, country: edit.country || "IT", sdi_code: edit.sdi_code || null, pec: edit.pec || null, email: edit.email || null };
    const res = edit.id ? await supabase.from("counterparts").update(row).eq("id", edit.id) : await supabase.from("counterparts").insert(row);
    setSaving(false);
    if (res.error) { setErr(`Non è stato possibile salvare: ${res.error.message}`); return; }
    setEdit(null); load();
  };
  const del = async () => { if (!supabase || !edit?.id) return; if (!(await ask({ message: "Eliminare questo intestatario?", danger: true, confirmLabel: "Elimina" }))) return; const r = await supabase.from("counterparts").delete().eq("id", edit.id); if (r.error) { setErr(`Non è stato possibile eliminare: ${r.error.message}`); return; } setEdit(null); load(); };

  const sel = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus max-sm:min-h-10";
  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  return (
    <div>
      <PageHeader title="Anagrafica clienti / agenzie" subtitle="Intestatari riutilizzabili per fatture e documenti" />
      <Card className="mb-4 max-sm:mb-3 max-sm:p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Cerca nome, P.IVA, CF…" className="w-full sm:w-72 max-sm:order-1 max-sm:w-[calc(100%-6rem)]" />
          {/* Telefono: un solo filtro (il tipo) → resta in riga, a tutta larghezza, senza pulsante «Filtri»; con Fatture in Cloud collegato «Sincronizza» gli sta accanto */}
          <div className="flex items-center gap-2 max-sm:order-3 max-sm:w-full sm:contents">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${sel} max-sm:h-9 max-sm:min-h-0 max-sm:min-w-0 max-sm:flex-1 max-sm:py-0 max-sm:text-[13px]`}><option value="all">Tutti</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {ficOn && <button onClick={openSync} className="ml-auto whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-dim hover:bg-wash max-sm:ml-0 max-sm:h-9 max-sm:min-h-0 max-sm:shrink-0 max-sm:py-0 max-sm:text-[13px] sm:order-1">Sincronizza<span className="max-sm:hidden"> con Fatture in Cloud</span></button>}
          </div>
          <button onClick={() => { setErr(""); setEdit(emptyForm()); }} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 max-sm:order-2 max-sm:h-9 max-sm:min-h-0 max-sm:w-[5.5rem] max-sm:py-0">+ Nuovo</button>
        </div>
      </Card>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="px-3 py-2 font-semibold">Nome</th><th className="px-3 py-2 font-semibold">Tipo</th><th className="px-3 py-2 font-semibold">P.IVA / CF</th><th className="px-3 py-2 font-semibold">Città</th><th className="px-3 py-2 font-semibold">Cod. dest. / PEC</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => openEdit(c)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                <td className="px-3 py-2.5 font-medium text-txt">{c.name}</td>
                <td className="px-3 py-2.5 text-dim">{KIND[c.kind] ?? c.kind}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-dim">{c.vat || c.tax_code || "—"}</td>
                <td className="px-3 py-2.5 text-dim">{[c.cap, c.city, c.province].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-3 py-2.5 text-xs text-dim">{c.sdi_code || c.pec || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && <EmptyState title="Nessun intestatario" sub="Aggiungi clienti e agenzie ricorrenti con “+ Nuovo”." />}
      </div>

      {sync.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setSync((p) => ({ ...p, open: false }))} className="absolute inset-0 bg-black/40" />
          <div className="relative flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-2 flex items-center justify-between"><span className="text-base font-bold text-txt">Sincronizza con Fatture in Cloud</span><button onClick={() => setSync((p) => ({ ...p, open: false }))} aria-label="Chiudi" className="rounded px-2 py-1 text-dim hover:bg-wash max-sm:px-3 max-sm:py-2.5">✕</button></div>
            {sync.busy && <p className="text-xs text-dim">Un attimo…</p>}
            {sync.msg && <p className="mb-2 rounded-lg bg-paper px-3 py-2 text-xs text-txt">{sync.msg}</p>}
            {sync.prev && (
              <>
                <p className="mb-3 text-xs text-dim">Xenora: {sync.prev.xenoraTotal} clienti · Fatture in Cloud: {sync.prev.ficTotal} · già allineati: {sync.prev.aligned}{sync.prev.duplicates > 0 ? ` · doppioni ignorati: ${sync.prev.duplicates}` : ""}. I clienti già presenti non vengono mai ricreati e su Fatture in Cloud non si modifica né si cancella nulla.</p>
                {sync.prev.truncated && <p className="mb-2 text-xs text-[color:var(--err)]">L&apos;elenco di Fatture in Cloud è molto lungo: il confronto è parziale, per sicurezza la sincronizzazione è bloccata.</p>}
                {([["send", "Da inviare a Fatture in Cloud", sync.prev.toSend], ["imp", "Da importare in Xenora", sync.prev.toImport]] as const).map(([w, title, items]) => (
                  <div key={w} className="mb-3">
                    <div className="mb-1 text-xs font-semibold text-txt">{title} ({items.length})</div>
                    {items.length === 0 ? <p className="text-xs text-faint">Nessuno: già tutto allineato.</p> : (
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-paper">
                        {items.map((it) => (
                          <label key={it.id} className="flex cursor-pointer items-center gap-2 border-b border-line px-2 py-1.5 text-xs last:border-0">
                            <input type="checkbox" checked={sync[w].has(it.id)} onChange={() => toggle(w, it.id)} />
                            <span className="font-medium text-txt">{it.name}</span>
                            <span className="ml-auto font-mono text-[11px] text-dim">{it.vat || it.tax_code || "—"}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <button onClick={applySync} disabled={sync.busy || sync.prev.truncated || (sync.send.size + sync.imp.size === 0)} className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Applica ({sync.send.size + sync.imp.size})</button>
                  <button onClick={() => setSync((p) => ({ ...p, open: false }))} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Chiudi</button>
                </div>
              </>
            )}
            {!sync.prev && !sync.busy && <div className="mt-2"><button onClick={() => setSync((p) => ({ ...p, open: false }))} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Chiudi</button></div>}
          </div>
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setEdit(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-2 flex items-center justify-between"><span className="text-lg font-bold text-txt">{edit.id ? "Modifica intestatario" : "Nuovo intestatario"}</span><button onClick={() => setEdit(null)} aria-label="Chiudi" className="rounded px-2 py-1 text-dim hover:bg-wash max-sm:px-3 max-sm:py-2.5">✕</button></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`${lbl} sm:col-span-2`}>Tipo<select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} className={inp}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className={`${lbl} sm:col-span-2`}>{edit.kind === "privato" ? "Nome e cognome" : "Ragione sociale"}<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inp} /></label>
              <label className={lbl}>Nazione<input value={edit.country} onChange={(e) => setEdit({ ...edit, country: e.target.value })} className={inp} /></label>
              {edit.kind !== "privato" ? <label className={lbl}>Partita IVA<input value={edit.vat} onChange={(e) => setEdit({ ...edit, vat: e.target.value })} className={inp} /></label> : <label className={lbl}>Codice fiscale<input value={edit.tax_code} onChange={(e) => setEdit({ ...edit, tax_code: e.target.value })} className={inp} /></label>}
              <label className={`${lbl} sm:col-span-2`}>Indirizzo<input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} className={inp} /></label>
              <label className={lbl}>Città<input value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} className={inp} /></label>
              <div className="grid grid-cols-2 gap-2"><label className={lbl}>CAP<input value={edit.cap} onChange={(e) => setEdit({ ...edit, cap: e.target.value })} className={inp} /></label><label className={lbl}>Prov.<input value={edit.province} onChange={(e) => setEdit({ ...edit, province: e.target.value })} className={inp} /></label></div>
              <label className={lbl}>Codice destinatario<input value={edit.sdi_code} onChange={(e) => setEdit({ ...edit, sdi_code: e.target.value })} className={inp} /></label>
              <label className={lbl}>PEC<input value={edit.pec} onChange={(e) => setEdit({ ...edit, pec: e.target.value })} className={inp} /></label>
              <label className={`${lbl} sm:col-span-2`}>Email<input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className={inp} /></label>
            </div>
            {err && <p role="alert" className="mt-2 rounded-lg bg-paper px-3 py-2 text-xs text-[color:var(--err)]">{err}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button onClick={save} disabled={saving} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 max-sm:min-h-11">{saving ? "Salvo…" : "Salva"}</button>
              {edit.id && <button onClick={del} className="rounded-lg px-3 py-2 text-sm font-medium text-faint hover:text-[color:var(--err)] max-sm:min-h-11">Elimina</button>}
              <button onClick={() => setEdit(null)} className="ml-auto rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash max-sm:min-h-11">Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
