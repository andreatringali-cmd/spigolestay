"use client";

// Anagrafica Clienti / Agenzie (intestatari riutilizzabili per la fatturazione).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { PageHeader, Card } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmProvider";

interface CP { id: string; kind: string; name: string; vat: string | null; tax_code: string | null; address: string | null; city: string | null; cap: string | null; province: string | null; country: string | null; sdi_code: string | null; pec: string | null; email: string | null }
const KIND: Record<string, string> = { privato: "Privato", societa: "Società", estero: "Estero", ota: "OTA / Agenzia" };
const emptyForm = () => ({ id: "", kind: "societa", name: "", vat: "", tax_code: "", address: "", city: "", cap: "", province: "", country: "IT", sdi_code: "", pec: "", email: "" });

export default function AnagraficaClientiPage() {
  const { user } = useAuth();
  const ask = useConfirm();
  const [list, setList] = useState<CP[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [edit, setEdit] = useState<ReturnType<typeof emptyForm> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data } = await supabase.from("counterparts").select("*").order("name");
    setList((data ?? []) as CP[]); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => list.filter((c) => (kind === "all" || c.kind === kind) && (!q.trim() || `${c.name} ${c.vat ?? ""} ${c.tax_code ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [list, q, kind]);

  const openEdit = (c: CP) => setEdit({ id: c.id, kind: c.kind, name: c.name, vat: c.vat ?? "", tax_code: c.tax_code ?? "", address: c.address ?? "", city: c.city ?? "", cap: c.cap ?? "", province: c.province ?? "", country: c.country ?? "IT", sdi_code: c.sdi_code ?? "", pec: c.pec ?? "", email: c.email ?? "" });
  const save = async () => {
    if (!supabase || !user || !edit || !edit.name.trim()) return;
    setSaving(true);
    const row = { tenant_id: user.id, kind: edit.kind, name: edit.name.trim(), vat: edit.vat || null, tax_code: edit.tax_code || null, address: edit.address || null, city: edit.city || null, cap: edit.cap || null, province: edit.province || null, country: edit.country || "IT", sdi_code: edit.sdi_code || null, pec: edit.pec || null, email: edit.email || null };
    const res = edit.id ? await supabase.from("counterparts").update(row).eq("id", edit.id) : await supabase.from("counterparts").insert(row);
    setSaving(false); if (!res.error) { setEdit(null); load(); }
  };
  const del = async () => { if (!supabase || !edit?.id) return; if (!(await ask({ message: "Eliminare questo intestatario?", danger: true, confirmLabel: "Elimina" }))) return; await supabase.from("counterparts").delete().eq("id", edit.id); setEdit(null); load(); };

  const sel = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  return (
    <div>
      <PageHeader title="Anagrafica clienti / agenzie" subtitle="Intestatari riutilizzabili per fatture e documenti" />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Cerca nome, P.IVA, CF…" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={sel}><option value="all">Tutti</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button onClick={() => setEdit(emptyForm())} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">+ Nuovo</button>
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
            {!loading && filtered.length === 0 && <tr><td colSpan={5}><EmptyState title="Nessun intestatario" sub="Aggiungi clienti e agenzie ricorrenti con “+ Nuovo”." /></td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setEdit(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-2 flex items-center justify-between"><span className="text-lg font-bold text-txt">{edit.id ? "Modifica intestatario" : "Nuovo intestatario"}</span><button onClick={() => setEdit(null)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
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
            <div className="mt-3 flex items-center gap-2">
              <button onClick={save} disabled={saving} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{saving ? "Salvo…" : "Salva"}</button>
              {edit.id && <button onClick={del} className="rounded-lg px-3 py-2 text-sm font-medium text-faint hover:text-[color:var(--err)]">Elimina</button>}
              <button onClick={() => setEdit(null)} className="ml-auto rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash">Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
