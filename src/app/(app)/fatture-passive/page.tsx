"use client";

// Fatture passive (acquisti/fornitori). CRUD lato client via Supabase (RLS tenant).
// Importi in centesimi; input in euro. Ispirato a Octorate, semplificato.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel } from "@/lib/types";
import { PageHeader, Card, StatCard } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmProvider";
import { eur } from "@/lib/format";
import { apiPost } from "@/lib/invoicing/client";

// Dati fornitore per le OTA (per l'autofattura: sede estera del cedente).
const OTA_META: Record<string, { name: string; country: string }> = {
  booking: { name: "Booking.com B.V.", country: "NL" },
  airbnb: { name: "Airbnb Ireland UC", country: "IE" },
  expedia: { name: "Expedia Lodging Partner Services Sàrl", country: "CH" },
  other: { name: "OTA estera", country: "EE" },
};
// Parsing numerico robusto: gestisce "1.234,56" (IT) e "1,234.56" (EN) e simboli valuta.
function parseNum(s: string): number {
  let x = (s ?? "").toString().replace(/[^\d.,-]/g, "").trim();
  if (!x) return 0;
  if (x.includes(",") && x.includes(".")) x = x.lastIndexOf(",") > x.lastIndexOf(".") ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, "");
  else if (x.includes(",")) x = x.replace(",", ".");
  const n = Number(x);
  return isNaN(n) ? 0 : n;
}

const CATEGORIES = ["Pulizie", "Utenze", "Manutenzione", "OTA / commissioni", "Forniture", "Consulenze", "Tasse e tributi", "Marketing", "Assicurazioni", "Altro"];
const TIPI: Record<string, string> = { fattura: "Fattura", nota_credito: "Nota di credito", ricevuta: "Ricevuta", spesa: "Spesa" };
const cents = (c?: number | null) => (c ?? 0) / 100;
const numv = (v: string | number) => { const n = Number(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const YEARS = (() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2]; })();

interface Doc { id: string; supplier_id: string | null; supplier_name: string | null; doc_number: string | null; doc_date: string | null; doc_type: string; category: string | null; taxable_cents: number; vat_cents: number; total_cents: number; due_date: string | null; paid: boolean; paid_at: string | null; payment_method: string | null; notes: string | null; selfinvoice_number: string | null; selfinvoice_status: string | null }
interface Supplier { id: string; name: string; vat: string | null; category: string | null }

const emptyForm = () => ({ id: "" as string, supplierName: "", supplierId: null as string | null, supplierCountry: "", doc_number: "", doc_date: todayISO(), doc_type: "fattura", category: "", taxableEur: "", vatEur: "", due_date: "", paid: false, paid_at: "", payment_method: "Bonifico bancario", notes: "" });
const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const prevMonth = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export default function FatturePassivePage() {
  const { user } = useAuth();
  const ask = useConfirm();
  const { bookings } = useData();
  // Modale "Autofattura OTA": #2 da commissioni tracciate, #3 import CSV.
  const [ota, setOta] = useState(false);
  const [otaMonth, setOtaMonth] = useState(prevMonth());
  const [otaChannel, setOtaChannel] = useState<Channel>("booking");
  const [csvTotal, setCsvTotal] = useState<number | null>(null);
  const [csvInfo, setCsvInfo] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // filtri
  const [q, setQ] = useState("");
  const [year, setYear] = useState<number | "all">(new Date().getFullYear());
  const [tipo, setTipo] = useState("all");
  const [pay, setPay] = useState("all");   // all | paid | unpaid
  const [scad, setScad] = useState("all"); // all | overdue
  // editor
  const [edit, setEdit] = useState<ReturnType<typeof emptyForm> | null>(null);
  const [saving, setSaving] = useState(false);
  // autofattura (reverse charge TD17) del documento selezionato
  const [af, setAf] = useState<{ number?: string; status?: string }>({});
  const [afBusy, setAfBusy] = useState("");
  const [afMsg, setAfMsg] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setErr("Devi essere connesso."); setLoading(false); return; }
    setLoading(true); setErr("");
    const [d, s] = await Promise.all([
      supabase.from("purchase_documents").select("*").order("doc_date", { ascending: false }),
      supabase.from("suppliers").select("id, name, vat, category").order("name"),
    ]);
    if (d.error) setErr(d.error.message); else setDocs((d.data ?? []) as Doc[]);
    setSuppliers((s.data ?? []) as Supplier[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const t = todayISO();
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return docs.filter((r) => {
      if (year !== "all" && (r.doc_date ?? "").slice(0, 4) !== String(year)) return false;
      if (tipo !== "all" && r.doc_type !== tipo) return false;
      if (pay === "paid" && !r.paid) return false;
      if (pay === "unpaid" && r.paid) return false;
      if (scad === "overdue" && !(r.due_date && r.due_date < t && !r.paid)) return false;
      if (term && !`${r.supplier_name ?? ""} ${r.doc_number ?? ""} ${r.category ?? ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [docs, q, year, tipo, pay, scad, t]);

  const totals = useMemo(() => filtered.reduce((a, r) => ({ imp: a.imp + r.taxable_cents, iva: a.iva + r.vat_cents, tot: a.tot + r.total_cents, unpaid: a.unpaid + (r.paid ? 0 : r.total_cents) }), { imp: 0, iva: 0, tot: 0, unpaid: 0 }), [filtered]);

  const openNew = () => { setEdit(emptyForm()); setAf({}); setAfMsg(""); };
  const openEdit = (r: Doc) => { setEdit({ id: r.id, supplierName: r.supplier_name ?? "", supplierId: r.supplier_id, supplierCountry: "", doc_number: r.doc_number ?? "", doc_date: r.doc_date ?? todayISO(), doc_type: r.doc_type, category: r.category ?? "", taxableEur: String(cents(r.taxable_cents)), vatEur: String(cents(r.vat_cents)), due_date: r.due_date ?? "", paid: r.paid, paid_at: r.paid_at ?? "", payment_method: r.payment_method ?? "Bonifico bancario", notes: r.notes ?? "" }); setAf({ number: r.selfinvoice_number ?? undefined, status: r.selfinvoice_status ?? undefined }); setAfMsg(""); };

  // Genera (ed eventualmente invia) l'autofattura TD17 reverse charge.
  const genAutofattura = async () => {
    if (!edit?.id) return;
    if (!(await ask({ title: "Autofattura reverse charge", message: "Generare l'autofattura TD17 per questa fattura estera? Se il provider SdI è configurato verrà anche trasmessa.", confirmLabel: "Genera" }))) return;
    setAfBusy("gen"); setAfMsg("");
    try { const r = await apiPost<{ ok: boolean; message?: string; number?: string; status?: string }>("invoicing/autofattura", { purchaseDocId: edit.id }); setAfMsg(r.message || ""); if (r.number) setAf({ number: r.number, status: r.status }); await load(); }
    catch (e) { setAfMsg(e instanceof Error ? e.message : "Errore"); } finally { setAfBusy(""); }
  };
  const dlAutofattura = async () => {
    if (!edit?.id) return;
    setAfBusy("xml"); setAfMsg("");
    try { const r = await apiPost<{ xml: string }>("invoicing/autofattura", { purchaseDocId: edit.id, action: "xml" }); const blob = new Blob([r.xml], { type: "application/xml" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `autofattura-${(af.number ?? edit.id).replace(/[^\w-]/g, "_")}.xml`; a.click(); URL.revokeObjectURL(a.href); }
    catch (e) { setAfMsg(e instanceof Error ? e.message : "Errore"); } finally { setAfBusy(""); }
  };

  // #2 — commissioni tracciate da Xenora per mese/canale (imponibile autofattura).
  const otaCommission = useMemo(() => {
    const [y, m] = otaMonth.split("-").map(Number);
    const start = `${otaMonth}-01`;
    const end = `${otaMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    const list = bookings.filter((b) => b.channel === otaChannel && b.status !== "cancelled" && (b.checkOut || "") >= start && (b.checkOut || "") <= end);
    const sum = list.reduce((a, b) => a + (b.total ?? 0) * (b.commissionPct ?? CHANNELS[b.channel].commission), 0);
    return { sum: Math.round(sum * 100) / 100, count: list.length, end };
  }, [bookings, otaChannel, otaMonth]);

  const precompileCommissions = () => {
    const meta = OTA_META[otaChannel] ?? OTA_META.other;
    setEdit({ ...emptyForm(), supplierName: meta.name, supplierCountry: meta.country, category: "OTA / commissioni", doc_date: otaCommission.end, taxableEur: otaCommission.sum.toFixed(2), notes: `Commissioni ${CHANNELS[otaChannel].label} ${otaMonth} (${otaCommission.count} prenotazioni) — imponibile per autofattura reverse charge. Verifica con la fattura del portale.` });
    setAf({}); setAfMsg(""); setOta(false);
  };

  // #3 — import CSV estratto commissioni (Booking Finance o simile).
  const onCsv = async (file: File) => {
    setCsvTotal(null); setCsvInfo("");
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) { setCsvInfo("File vuoto."); return; }
    const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
    const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
    let col = header.findIndex((h) => /commission|commissione/.test(h));
    if (col < 0) col = header.findIndex((h) => /amount|importo|totale|total/.test(h));
    if (col < 0) { setCsvInfo("Colonna importo non trovata (cerco 'commissione'/'importo')."); return; }
    let sum = 0, rows = 0;
    for (const l of lines.slice(1)) { const v = parseNum(l.split(delim)[col] || ""); if (v) { sum += v; rows++; } }
    setCsvTotal(Math.round(sum * 100) / 100); setCsvInfo(`${rows} righe · colonna "${header[col]}"`);
  };
  const precompileCsv = () => {
    if (csvTotal == null) return;
    const meta = OTA_META[otaChannel] ?? OTA_META.booking;
    setEdit({ ...emptyForm(), supplierName: meta.name, supplierCountry: meta.country, category: "OTA / commissioni", doc_date: otaCommission.end, taxableEur: csvTotal.toFixed(2), notes: `Import CSV commissioni ${CHANNELS[otaChannel].label} ${otaMonth}` });
    setAf({}); setAfMsg(""); setOta(false); setCsvTotal(null); setCsvInfo("");
  };

  const save = async () => {
    if (!supabase || !user || !edit) return;
    setSaving(true); setErr("");
    // Fornitore: usa quello scelto o crea/riusa per nome.
    let supplierId = edit.supplierId;
    const nameTrim = edit.supplierName.trim();
    if (nameTrim) {
      const existing = suppliers.find((s) => s.name.toLowerCase() === nameTrim.toLowerCase());
      if (existing) { supplierId = existing.id; if (edit.supplierCountry) await supabase.from("suppliers").update({ country: edit.supplierCountry }).eq("id", existing.id); }
      else { const { data: ns } = await supabase.from("suppliers").insert({ tenant_id: user.id, name: nameTrim, category: edit.category || null, country: edit.supplierCountry || null }).select("id").single(); supplierId = ns?.id ?? null; }
    }
    const taxable = Math.round(numv(edit.taxableEur) * 100);
    const vat = Math.round(numv(edit.vatEur) * 100);
    const row = {
      tenant_id: user.id, supplier_id: supplierId, supplier_name: nameTrim || null, doc_number: edit.doc_number || null,
      doc_date: edit.doc_date || null, doc_type: edit.doc_type, category: edit.category || null,
      taxable_cents: taxable, vat_cents: vat, total_cents: taxable + vat, due_date: edit.due_date || null,
      paid: edit.paid, paid_at: edit.paid ? (edit.paid_at || todayISO()) : null, payment_method: edit.payment_method || null,
      notes: edit.notes || null, updated_at: new Date().toISOString(),
    };
    const res = edit.id ? await supabase.from("purchase_documents").update(row).eq("id", edit.id) : await supabase.from("purchase_documents").insert(row);
    setSaving(false);
    if (res.error) { setErr(res.error.message); return; }
    setEdit(null); await load();
  };
  const del = async () => {
    if (!supabase || !edit?.id) return;
    if (!(await ask({ message: "Eliminare questa fattura passiva?", danger: true, confirmLabel: "Elimina" }))) return;
    await supabase.from("purchase_documents").delete().eq("id", edit.id);
    setEdit(null); await load();
  };
  const togglePaid = async (r: Doc) => { if (!supabase) return; await supabase.from("purchase_documents").update({ paid: !r.paid, paid_at: !r.paid ? todayISO() : null }).eq("id", r.id); await load(); };

  const exportCsv = () => {
    const head = ["Data", "Fornitore", "Numero", "Tipo", "Categoria", "Imponibile", "IVA", "Totale", "Scadenza", "Pagata"];
    const lines = filtered.map((r) => [r.doc_date ?? "", r.supplier_name ?? "", r.doc_number ?? "", TIPI[r.doc_type], r.category ?? "", cents(r.taxable_cents).toFixed(2), cents(r.vat_cents).toFixed(2), cents(r.total_cents).toFixed(2), r.due_date ?? "", r.paid ? "sì" : "no"].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `fatture-passive-${year}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const sel = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";
  const totEur = numv(edit?.taxableEur ?? 0) + numv(edit?.vatEur ?? 0);

  return (
    <div>
      <PageHeader title="Fatture passive" subtitle="Fatture e costi dei fornitori" />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Imponibile", totals.imp, "var(--dim)"], ["IVA", totals.iva, "var(--dim)"], ["Totale", totals.tot, "var(--txt)"], ["Da pagare", totals.unpaid, totals.unpaid > 0 ? "var(--warn)" : "var(--ok)"]].map(([l, v, c]) => (
          <StatCard key={l as string} label={l as string} value={eur(cents(v as number))} color={c as string} />
        ))}
      </div>

      <Card className="mb-4">
        {/* Stessa griglia dei KPI sopra: ricerca larga quanto una card e allineata. */}
        <div className="grid grid-cols-2 items-center gap-3 sm:grid-cols-4">
          <SearchInput value={q} onChange={setQ} placeholder="Cerca fornitore, numero, categoria…" className="col-span-2 w-full sm:col-span-1" />
          <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-3">
            <select value={String(year)} onChange={(e) => setYear(e.target.value === "all" ? "all" : Number(e.target.value))} className={sel}><option value="all">Tutti gli anni</option>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={sel}><option value="all">Tutti i tipi</option>{Object.entries(TIPI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={pay} onChange={(e) => setPay(e.target.value)} className={sel}><option value="all">Pagate e non</option><option value="unpaid">Da pagare</option><option value="paid">Pagate</option></select>
            <select value={scad} onChange={(e) => setScad(e.target.value)} className={sel}><option value="all">Tutte le scadenze</option><option value="overdue">Scadute non pagate</option></select>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={exportCsv} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">Esporta CSV</button>
              <button onClick={() => { setOta(true); setCsvTotal(null); setCsvInfo(""); }} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash" title="Precompila una fattura passiva OTA dalle commissioni tracciate o da un CSV">⚡ Autofattura OTA</button>
              <button onClick={openNew} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">+ Nuova fattura</button>
            </div>
          </div>
        </div>
      </Card>

      {err && <Card className="mb-4"><p className="text-sm text-[color:var(--err)]">{err}</p></Card>}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-3 py-2 font-semibold">Data</th><th className="px-3 py-2 font-semibold">Fornitore</th><th className="px-3 py-2 font-semibold">Numero</th><th className="px-3 py-2 font-semibold">Tipo</th><th className="px-3 py-2 font-semibold">Categoria</th><th className="px-3 py-2 text-right font-semibold">Imponibile</th><th className="px-3 py-2 text-right font-semibold">IVA</th><th className="px-3 py-2 text-right font-semibold">Totale</th><th className="px-3 py-2 font-semibold">Scadenza</th><th className="px-3 py-2 font-semibold">Stato</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const overdue = r.due_date && r.due_date < t && !r.paid;
              return (
                <tr key={r.id} onClick={() => openEdit(r)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                  <td className="whitespace-nowrap px-3 py-2.5 text-dim">{r.doc_date ? new Date(r.doc_date).toLocaleDateString("it-IT") : "—"}</td>
                  <td className="px-3 py-2.5 font-medium text-txt">{r.supplier_name || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-dim">{r.doc_number || "—"}</td>
                  <td className="px-3 py-2.5 text-dim">{TIPI[r.doc_type]}</td>
                  <td className="px-3 py-2.5 text-dim">{r.category || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{eur(cents(r.taxable_cents))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{eur(cents(r.vat_cents))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(cents(r.total_cents))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs" style={{ color: overdue ? "var(--err)" : "var(--dim)" }}>{r.due_date ? new Date(r.due_date).toLocaleDateString("it-IT") : "—"}</td>
                  <td className="px-3 py-2.5" onClick={(e) => { e.stopPropagation(); togglePaid(r); }}>
                    <span className="cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${r.paid ? "var(--ok)" : overdue ? "var(--err)" : "var(--warn)"} 16%, transparent)`, color: r.paid ? "var(--ok)" : overdue ? "var(--err)" : "var(--warn)" }}>{r.paid ? "Pagata" : overdue ? "Scaduta" : "Da pagare"}</span>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && <tr><td colSpan={10}><EmptyState title="Nessuna fattura passiva" sub="Registra la prima con “+ Nuova fattura”." /></td></tr>}
            {loading && <tr><td colSpan={10} className="px-3 py-10 text-center text-sm text-faint">Caricamento…</td></tr>}
          </tbody>
        </table>
      </div>

      {ota && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setOta(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-2 flex items-center justify-between"><span className="text-lg font-bold text-txt">Autofattura OTA — precompila</span><button onClick={() => setOta(false)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={lbl}>Canale<select value={otaChannel} onChange={(e) => setOtaChannel(e.target.value as Channel)} className={inp}>{(["booking", "airbnb", "expedia", "hotelbeds", "other"] as Channel[]).map((c) => <option key={c} value={c}>{CHANNELS[c].label}</option>)}</select></label>
              <label className={lbl}>Mese<input type="month" value={otaMonth} max={monthNow()} onChange={(e) => setOtaMonth(e.target.value)} className={inp} /></label>
            </div>

            <div className="mt-3 rounded-lg border border-line p-3">
              <div className="text-xs font-semibold text-txt">1) Dalle commissioni tracciate da Xenora</div>
              <p className="mt-1 text-[11px] text-faint">Somma le commissioni ({CHANNELS[otaChannel].label}) delle prenotazioni con partenza nel mese scelto.</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-dim">{otaCommission.count} prenotazioni · stimato</span>
                <span className="font-mono text-lg font-bold text-txt">{eur(otaCommission.sum)}</span>
              </div>
              <button onClick={precompileCommissions} disabled={otaCommission.sum <= 0} className="mt-2 w-full rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Precompila da commissioni</button>
            </div>

            <div className="mt-3 rounded-lg border border-line p-3">
              <div className="text-xs font-semibold text-txt">2) Da CSV del portale (importi ufficiali)</div>
              <p className="mt-1 text-[11px] text-faint">Estratto commissioni dall&apos;area Finance del portale (colonna &quot;commissione&quot; o &quot;importo&quot;).</p>
              <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(f); }} className="mt-2 block w-full text-xs text-dim file:mr-2 file:rounded-lg file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-txt" />
              {csvInfo && <p className="mt-1 text-[11px] text-faint">{csvInfo}</p>}
              {csvTotal != null && <div className="mt-2 flex items-center justify-between"><span className="text-sm text-dim">Totale rilevato</span><span className="font-mono text-lg font-bold text-txt">{eur(csvTotal)}</span></div>}
              <button onClick={precompileCsv} disabled={csvTotal == null || csvTotal <= 0} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">Precompila da CSV</button>
            </div>
            <p className="mt-3 text-[11px] text-faint">Dopo la precompilazione controlla l&apos;imponibile con la fattura del portale, salva, poi premi &quot;Genera autofattura TD17&quot;.</p>
          </div>
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setEdit(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-2 flex items-center justify-between"><span className="text-lg font-bold text-txt">{edit.id ? "Modifica fattura passiva" : "Nuova fattura passiva"}</span><button onClick={() => setEdit(null)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`${lbl} sm:col-span-2`}>Fornitore
                <input list="sup-list" value={edit.supplierName} onChange={(e) => setEdit({ ...edit, supplierName: e.target.value, supplierId: null })} className={inp} placeholder="Nome fornitore" />
                <datalist id="sup-list">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
              </label>
              <label className={lbl}>Numero documento<input value={edit.doc_number} onChange={(e) => setEdit({ ...edit, doc_number: e.target.value })} className={inp} /></label>
              <label className={lbl}>Data<input type="date" value={edit.doc_date} onChange={(e) => setEdit({ ...edit, doc_date: e.target.value })} className={inp} /></label>
              <label className={lbl}>Tipo<select value={edit.doc_type} onChange={(e) => setEdit({ ...edit, doc_type: e.target.value })} className={inp}>{Object.entries(TIPI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className={lbl}>Categoria<select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} className={inp}><option value="">—</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label className={lbl}>Imponibile €<input value={edit.taxableEur} onChange={(e) => setEdit({ ...edit, taxableEur: e.target.value })} className={inp} inputMode="decimal" /></label>
              <label className={lbl}>IVA €<input value={edit.vatEur} onChange={(e) => setEdit({ ...edit, vatEur: e.target.value })} className={inp} inputMode="decimal" /></label>
              <div className="sm:col-span-2 flex items-center justify-between rounded-lg bg-wash px-3 py-2 text-sm"><span className="text-dim">Totale</span><span className="font-mono font-bold text-txt">{eur(totEur)}</span></div>
              <label className={lbl}>Scadenza pagamento<input type="date" value={edit.due_date} onChange={(e) => setEdit({ ...edit, due_date: e.target.value })} className={inp} /></label>
              <label className={lbl}>Metodo<select value={edit.payment_method} onChange={(e) => setEdit({ ...edit, payment_method: e.target.value })} className={inp}><option>Bonifico bancario</option><option>Carta</option><option>Contanti</option><option>RID/SDD</option><option>PayPal</option></select></label>
              <label className="sm:col-span-2 flex items-center gap-2 pt-1"><input type="checkbox" checked={edit.paid} onChange={(e) => setEdit({ ...edit, paid: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /><span className="text-sm text-txt">Pagata</span>{edit.paid && <input type="date" value={edit.paid_at || todayISO()} onChange={(e) => setEdit({ ...edit, paid_at: e.target.value })} className="ml-auto rounded-lg border border-line bg-paper px-2 py-1 text-sm" />}</label>
              <label className={`${lbl} sm:col-span-2`}>Note<textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} rows={2} className={inp} /></label>
            </div>
            {edit.id && (
              <div className="mt-3 rounded-lg border border-line bg-wash/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-txt">Autofattura reverse charge (TD17)</span>
                  {af.status && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${af.status === "scartata" ? "var(--err)" : af.status === "generata" ? "var(--warn)" : "var(--ok)"} 16%, transparent)`, color: af.status === "scartata" ? "var(--err)" : af.status === "generata" ? "var(--warn)" : "var(--ok)" }}>{af.number ? `${af.number} · ` : ""}{af.status}</span>}
                </div>
                <p className="mt-1 text-[11px] text-faint">Per commissioni/servizi da fornitori esteri (OTA) va emessa l&apos;autofattura in reverse charge. L&apos;imponibile è l&apos;importo indicato sopra; IVA 22%.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button onClick={genAutofattura} disabled={!!afBusy} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{afBusy === "gen" ? "Genero…" : af.status ? "Rigenera autofattura" : "Genera autofattura TD17"}</button>
                  {af.status && <button onClick={dlAutofattura} disabled={!!afBusy} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{afBusy === "xml" ? "Scarico…" : "Scarica XML"}</button>}
                </div>
                {afMsg && <p className="mt-2 text-[12px] text-dim">{afMsg}</p>}
              </div>
            )}
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
