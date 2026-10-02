"use client";

// Fatture passive (acquisti/fornitori). CRUD lato client via Supabase (RLS tenant).
// Importi in centesimi; input in euro. Ispirato a Octorate, semplificato.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel } from "@/lib/types";
import { commissionOf } from "@/lib/booking";
import { PageHeader, Card, StatCard } from "@/components/ui";
import SearchInput from "@/components/SearchInput";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmProvider";
import { eur } from "@/lib/format";
import { apiPost } from "@/lib/invoicing/client";
import { groupTotals, dueSummary, matchesDue, toCashRow, findDuplicate, signedCents, csvCell, type DueFilter } from "@/lib/purchases";

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

interface Doc { id: string; structure_id: string | null; supplier_id: string | null; supplier_name: string | null; doc_number: string | null; doc_date: string | null; doc_type: string; category: string | null; taxable_cents: number; vat_cents: number; total_cents: number; due_date: string | null; paid: boolean; paid_at: string | null; payment_method: string | null; notes: string | null; selfinvoice_number: string | null; selfinvoice_status: string | null }
interface Supplier { id: string; name: string; vat: string | null; category: string | null }

// structureId: "" = da scegliere, "common" = comune a tutte le strutture (salvato come null), altrimenti id struttura.
const emptyForm = (structureId = "") => ({ id: "" as string, structureId, supplierName: "", supplierId: null as string | null, supplierCountry: "", doc_number: "", doc_date: todayISO(), doc_type: "fattura", category: "", taxableEur: "", vatEur: "", due_date: "", paid: false, paid_at: "", payment_method: "Bonifico bancario", notes: "" });
const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const prevMonth = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export default function FatturePassivePage() {
  const { user } = useAuth();
  const ask = useConfirm();
  const { bookings: allBookings, structures, activeStructureId } = useData();
  const single = activeStructureId !== "all";
  // Le commissioni OTA tracciate (autofattura) valgono solo per la struttura attiva.
  const bookings = useMemo(() => (single ? allBookings.filter((b) => b.structureId === activeStructureId) : allBookings), [allBookings, single, activeStructureId]);
  const structName = (id: string | null) => (id ? structures.find((s) => s.id === id)?.name ?? "—" : "Comune");
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
  const [scad, setScad] = useState<DueFilter>("all"); // all | overdue | week
  const [catF, setCatF] = useState("all");
  const [supF, setSupF] = useState("all");
  const [view, setView] = useState<"elenco" | "riepiloghi">("elenco");
  const [sumBy, setSumBy] = useState<"supplier" | "category" | "month">("supplier");
  const [sort, setSort] = useState<{ key: "doc_date" | "supplier_name" | "total_cents" | "due_date"; dir: 1 | -1 }>({ key: "doc_date", dir: -1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [inCassa, setInCassa] = useState<Set<string>>(new Set());
  const [info, setInfo] = useState("");
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
    // Documenti già registrati in Cassa: il movimento ha lo stesso id del documento.
    if (!d.error) {
      const paidIds = ((d.data ?? []) as Doc[]).filter((x) => x.paid).map((x) => x.id);
      const found = new Set<string>();
      for (let i = 0; i < paidIds.length; i += 60) {
        const { data: cm } = await supabase.from("cash_movements").select("id").in("id", paidIds.slice(i, i + 60));
        for (const r of (cm ?? []) as { id: string }[]) found.add(r.id);
      }
      setInCassa(found);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const t = todayISO();
  // Ambito struttura (stessa regola di prima: senza struttura = solo con "Tutte").
  const scoped = useMemo(() => docs.filter((r) => !single || r.structure_id === activeStructureId), [docs, single, activeStructureId]);
  // Scadenzario: su tutti i documenti non pagati dell'ambito, indipendentemente dai filtri.
  const due = useMemo(() => dueSummary(scoped, t), [scoped, t]);
  const supplierNames = useMemo(() => Array.from(new Set(scoped.map((r) => (r.supplier_name ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "it")), [scoped]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = scoped.filter((r) => {
      if (year !== "all" && (r.doc_date ?? "").slice(0, 4) !== String(year)) return false;
      if (tipo !== "all" && r.doc_type !== tipo) return false;
      if (pay === "paid" && !r.paid) return false;
      if (pay === "unpaid" && r.paid) return false;
      if (!matchesDue(r, scad, t)) return false;
      if (catF !== "all" && (r.category ?? "") !== (catF === "none" ? "" : catF)) return false;
      if (supF !== "all" && (r.supplier_name ?? "").trim() !== supF) return false;
      if (term && !`${r.supplier_name ?? ""} ${r.doc_number ?? ""} ${r.category ?? ""} ${r.notes ?? ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
    const k = sort.key;
    return list.sort((a, b) => {
      const av = k === "total_cents" ? signedCents(a, a.total_cents) : (a[k] ?? "");
      const bv = k === "total_cents" ? signedCents(b, b.total_cents) : (b[k] ?? "");
      // documenti senza valore (es. senza scadenza) sempre in fondo
      if (av === "" && bv !== "") return 1;
      if (bv === "" && av !== "") return -1;
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });
  }, [scoped, q, year, tipo, pay, scad, catF, supF, sort, t]);

  // Totali con segno: le note di credito riducono il costo.
  const totals = useMemo(() => filtered.reduce((a, r) => ({ imp: a.imp + signedCents(r, r.taxable_cents), iva: a.iva + signedCents(r, r.vat_cents), tot: a.tot + signedCents(r, r.total_cents), unpaid: a.unpaid + (r.paid || r.doc_type === "nota_credito" ? 0 : signedCents(r, r.total_cents)) }), { imp: 0, iva: 0, tot: 0, unpaid: 0 }), [filtered]);
  const summary = useMemo(() => groupTotals(filtered, sumBy), [filtered, sumBy]);
  const sortBy = (key: typeof sort.key) => setSort((p) => ({ key, dir: p.key === key ? (p.dir === 1 ? -1 : 1) : (key === "supplier_name" || key === "due_date" ? 1 : -1) }));
  const arrow = (key: typeof sort.key) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const filtersActive = q || tipo !== "all" || pay !== "all" || scad !== "all" || catF !== "all" || supF !== "all";
  const resetFilters = () => { setQ(""); setTipo("all"); setPay("all"); setScad("all"); setCatF("all"); setSupF("all"); };
  const pickDue = (f: DueFilter) => { if (scad === f) { setScad("all"); return; } setScad(f); setPay("all"); setYear("all"); setView("elenco"); };

  const defStructure = single ? activeStructureId : structures.length === 1 ? structures[0].id : "";
  const openNew = () => { setEdit(emptyForm(defStructure)); setAf({}); setAfMsg(""); };
  const openEdit = (r: Doc) => { setEdit({ id: r.id, structureId: r.structure_id ?? "common", supplierName: r.supplier_name ?? "", supplierId: r.supplier_id, supplierCountry: "", doc_number: r.doc_number ?? "", doc_date: r.doc_date ?? todayISO(), doc_type: r.doc_type, category: r.category ?? "", taxableEur: String(cents(r.taxable_cents)), vatEur: String(cents(r.vat_cents)), due_date: r.due_date ?? "", paid: r.paid, paid_at: r.paid_at ?? "", payment_method: r.payment_method ?? "Bonifico bancario", notes: r.notes ?? "" }); setAf({ number: r.selfinvoice_number ?? undefined, status: r.selfinvoice_status ?? undefined }); setAfMsg(""); };

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
    const sum = list.reduce((a, b) => a + commissionOf(b), 0);
    return { sum: Math.round(sum * 100) / 100, count: list.length, end };
  }, [bookings, otaChannel, otaMonth]);

  const precompileCommissions = () => {
    const meta = OTA_META[otaChannel] ?? OTA_META.other;
    setEdit({ ...emptyForm(defStructure), supplierName: meta.name, supplierCountry: meta.country, category: "OTA / commissioni", doc_date: otaCommission.end, taxableEur: otaCommission.sum.toFixed(2), notes: `Commissioni ${CHANNELS[otaChannel].label} ${otaMonth} (${otaCommission.count} prenotazioni) — imponibile per autofattura reverse charge. Verifica con la fattura del portale.` });
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
    setEdit({ ...emptyForm(defStructure), supplierName: meta.name, supplierCountry: meta.country, category: "OTA / commissioni", doc_date: otaCommission.end, taxableEur: csvTotal.toFixed(2), notes: `Import CSV commissioni ${CHANNELS[otaChannel].label} ${otaMonth}` });
    setAf({}); setAfMsg(""); setOta(false); setCsvTotal(null); setCsvInfo("");
  };

  const save = async () => {
    if (!supabase || !user || !edit) return;
    if (!edit.structureId && structures.length > 1) { setErr("Scegli la struttura a cui appartiene la fattura (o «Comune a tutte»)."); return; }
    const dup = findDuplicate(docs, { id: edit.id || undefined, supplier_name: edit.supplierName, doc_number: edit.doc_number, doc_date: edit.doc_date });
    if (dup && !(await ask({ title: "Possibile duplicato", message: `Esiste già un documento n. ${dup.doc_number} di ${dup.supplier_name} del ${dup.doc_date ? new Date(dup.doc_date).toLocaleDateString("it-IT") : "—"}. Salvare comunque?`, confirmLabel: "Salva comunque" }))) return;
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
      tenant_id: user.id, structure_id: edit.structureId && edit.structureId !== "common" ? edit.structureId : null, supplier_id: supplierId, supplier_name: nameTrim || null, doc_number: edit.doc_number || null,
      doc_date: edit.doc_date || null, doc_type: edit.doc_type, category: edit.category || null,
      taxable_cents: taxable, vat_cents: vat, total_cents: taxable + vat, due_date: edit.due_date || null,
      paid: edit.paid, paid_at: edit.paid ? (edit.paid_at || todayISO()) : null, payment_method: edit.payment_method || null,
      notes: edit.notes || null, updated_at: new Date().toISOString(),
    };
    const res = edit.id ? await supabase.from("purchase_documents").update(row).eq("id", edit.id) : await supabase.from("purchase_documents").insert(row);
    setSaving(false);
    if (res.error) { setErr(res.error.message); return; }
    // Se il documento era già in Cassa, il movimento resta allineato (o viene tolto se non è più pagato).
    if (edit.id && inCassa.has(edit.id)) await syncCash({ id: edit.id, ...row } as unknown as Doc);
    setEdit(null); await load();
  };
  const del = async () => {
    if (!supabase || !edit?.id) return;
    if (!(await ask({ message: "Eliminare questa fattura passiva?", danger: true, confirmLabel: "Elimina" }))) return;
    await supabase.from("cash_movements").delete().eq("id", edit.id);
    await supabase.from("purchase_documents").delete().eq("id", edit.id);
    setEdit(null); await load();
  };

  // ---- Collegamento alla Cassa: il movimento ha lo stesso id del documento (nessun doppione possibile).
  const syncCash = async (d: Doc) => {
    if (!supabase || !user) return;
    const row = toCashRow(d, user.id, todayISO());
    if (!row) { await supabase.from("cash_movements").delete().eq("id", d.id); return; }
    await supabase.from("cash_movements").upsert(row, { onConflict: "id" });
  };
  const registerCash = async (list: Doc[]) => {
    if (!supabase || !user) return;
    const rows = list.map((d) => toCashRow(d, user.id, todayISO())).filter((x): x is NonNullable<typeof x> => !!x);
    if (!rows.length) { setInfo("Nessun documento pagato da registrare in Cassa."); return; }
    const { error } = await supabase.from("cash_movements").upsert(rows, { onConflict: "id" });
    if (error) { setErr(error.message); return; }
    setInfo(`${rows.length} ${rows.length === 1 ? "documento registrato" : "documenti registrati"} in Cassa.`); setSel(new Set()); await load();
  };
  const unregisterCash = async (id: string) => {
    if (!supabase) return;
    await supabase.from("cash_movements").delete().eq("id", id);
    setInfo("Movimento rimosso dalla Cassa."); await load();
  };
  const togglePaid = async (r: Doc) => {
    if (!supabase) return;
    await supabase.from("purchase_documents").update({ paid: !r.paid, paid_at: !r.paid ? todayISO() : null, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (r.paid && inCassa.has(r.id)) await supabase.from("cash_movements").delete().eq("id", r.id); // non più pagata: via dalla Cassa
    await load();
  };
  const bulkPaid = async () => {
    if (!supabase || sel.size === 0) return;
    const ids = filtered.filter((r) => sel.has(r.id) && !r.paid).map((r) => r.id);
    if (!ids.length) { setInfo("I documenti selezionati risultano già pagati."); return; }
    if (!(await ask({ title: "Segna come pagate", message: `Segnare ${ids.length} document${ids.length === 1 ? "o" : "i"} come pagat${ids.length === 1 ? "o" : "i"} con data di oggi?`, confirmLabel: "Segna pagate" }))) return;
    const { error } = await supabase.from("purchase_documents").update({ paid: true, paid_at: todayISO(), updated_at: new Date().toISOString() }).in("id", ids);
    if (error) { setErr(error.message); return; }
    setInfo(`${ids.length} document${ids.length === 1 ? "o segnato" : "i segnati"} come pagat${ids.length === 1 ? "o" : "i"}.`); setSel(new Set()); await load();
  };

  // CSV per Excel italiano: separatore ";" e decimali con virgola; le note di credito sono negative.
  const dl = (name: string, lines: string[]) => { const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); };
  const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const exportCsv = () => {
    const head = ["Data", "Struttura", "Fornitore", "Numero", "Tipo", "Categoria", "Imponibile", "IVA", "Totale", "Scadenza", "Pagata", "Data pagamento", "Metodo", "In Cassa"];
    const lines = filtered.map((r) => [r.doc_date ?? "", structName(r.structure_id), r.supplier_name ?? "", r.doc_number ?? "", TIPI[r.doc_type], r.category ?? "", money(signedCents(r, r.taxable_cents)), money(signedCents(r, r.vat_cents)), money(signedCents(r, r.total_cents)), r.due_date ?? "", r.paid ? "sì" : "no", r.paid_at ?? "", r.payment_method ?? "", inCassa.has(r.id) ? "sì" : "no"].map(csvCell).join(";"));
    dl(`fatture-passive-${year}.csv`, [head.map(csvCell).join(";"), ...lines]);
  };
  const exportSummary = () => {
    const label = sumBy === "supplier" ? "Fornitore" : sumBy === "category" ? "Categoria" : "Mese";
    const head = [label, "Documenti", "Imponibile", "IVA", "Totale", "Da pagare"];
    dl(`riepilogo-fatture-passive-${sumBy}-${year}.csv`, [head.map(csvCell).join(";"), ...summary.map((r) => [r.key, r.count, money(r.taxable), money(r.vat), money(r.total), money(r.unpaid)].map(csvCell).join(";"))]);
  };

  const selCls = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";
  const totEur = numv(edit?.taxableEur ?? 0) + numv(edit?.vatEur ?? 0);

  return (
    <div>
      <PageHeader title="Fatture passive" subtitle="Fatture e costi dei fornitori" />

      {/* Scadenzario: sempre sui documenti non pagati, a prescindere dai filtri. Clic = filtra l'elenco. */}
      {(due.overdue.count + due.week.count + due.later.count + due.noDate.count) > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            ["Scadute", due.overdue, "var(--err)", "overdue"],
            ["Scadono entro 7 giorni", due.week, "var(--warn)", "week"],
            ["Più avanti", due.later, "var(--dim)", null],
            ["Senza scadenza", due.noDate, "var(--faint)", null],
          ] as [string, { count: number; cents: number }, string, DueFilter | null][]).map(([l, b, col, f]) => (
            <StatCard key={l} label={l} value={eur(cents(b.cents))} color={b.count > 0 ? col : "var(--faint)"} hint={`${b.count} ${b.count === 1 ? "documento" : "documenti"} da pagare`} onClick={f ? () => pickDue(f) : undefined} active={!!f && scad === f} />
          ))}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Imponibile", totals.imp, "var(--dim)"], ["IVA", totals.iva, "var(--dim)"], ["Totale", totals.tot, "var(--txt)"], ["Da pagare", totals.unpaid, totals.unpaid > 0 ? "var(--warn)" : "var(--ok)"]].map(([l, v, c]) => (
          <StatCard key={l as string} label={l as string} value={eur(cents(v as number))} color={c as string} />
        ))}
      </div>

      <Card className="mb-4">
        {/* Stessa griglia dei KPI sopra: ricerca larga quanto una card e allineata. */}
        <div className="grid grid-cols-2 items-center gap-3 sm:grid-cols-4">
          <SearchInput value={q} onChange={setQ} placeholder="Cerca fornitore, numero, categoria, note…" className="col-span-2 w-full sm:col-span-1" />
          <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-3">
            <select value={String(year)} onChange={(e) => setYear(e.target.value === "all" ? "all" : Number(e.target.value))} className={selCls}><option value="all">Tutti gli anni</option>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={selCls}><option value="all">Tutti i tipi</option>{Object.entries(TIPI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={pay} onChange={(e) => setPay(e.target.value)} className={selCls}><option value="all">Pagate e non</option><option value="unpaid">Da pagare</option><option value="paid">Pagate</option></select>
            <select value={scad} onChange={(e) => setScad(e.target.value as DueFilter)} className={selCls}><option value="all">Tutte le scadenze</option><option value="overdue">Scadute non pagate</option><option value="week">In scadenza entro 7 giorni</option></select>
            <select value={catF} onChange={(e) => setCatF(e.target.value)} className={selCls}><option value="all">Tutte le categorie</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}<option value="none">Senza categoria</option></select>
            <select value={supF} onChange={(e) => setSupF(e.target.value)} className={`${selCls} max-w-[200px]`}><option value="all">Tutti i fornitori</option>{supplierNames.map((n) => <option key={n} value={n}>{n}</option>)}</select>
            {filtersActive ? <button onClick={resetFilters} className="text-xs font-semibold text-focus hover:underline">Azzera filtri</button> : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {(["elenco", "riepiloghi"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition ${view === v ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{v}</button>
            ))}
          </div>
          <span className="text-xs text-faint">{filtered.length} {filtered.length === 1 ? "documento" : "documenti"}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button onClick={view === "elenco" ? exportCsv : exportSummary} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">{view === "elenco" ? "Esporta CSV" : "Esporta riepilogo"}</button>
            <button onClick={() => { setOta(true); setCsvTotal(null); setCsvInfo(""); }} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash" title="Precompila una fattura passiva OTA dalle commissioni tracciate o da un CSV">⚡ Autofattura OTA</button>
            <button onClick={openNew} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">+ Nuova fattura</button>
          </div>
        </div>
      </Card>

      {err && <Card className="mb-4"><p className="text-sm text-[color:var(--err)]">{err}</p></Card>}
      {info && <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-wash px-3 py-2 text-sm font-medium text-txt"><span className="flex-1">{info}</span><button onClick={() => setInfo("")} className="rounded px-2 text-dim hover:bg-surface">✕</button></div>}

      {view === "riepiloghi" && (
        <Card className="mb-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              {([["supplier", "Per fornitore"], ["category", "Per categoria"], ["month", "Per mese"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setSumBy(k)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${sumBy === k ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{l}</button>
              ))}
            </div>
            <span className="text-xs text-faint">Sui documenti che corrispondono ai filtri qui sopra; le note di credito sono sottratte.</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-3 py-2 font-semibold">{sumBy === "supplier" ? "Fornitore" : sumBy === "category" ? "Categoria" : "Mese"}</th><th className="px-3 py-2 text-right font-semibold">Doc.</th><th className="px-3 py-2 text-right font-semibold">Imponibile</th><th className="px-3 py-2 text-right font-semibold">IVA</th><th className="px-3 py-2 text-right font-semibold">Totale</th><th className="px-3 py-2 text-right font-semibold">Da pagare</th><th className="w-40 px-3 py-2 font-semibold">Quota</th>
              </tr></thead>
              <tbody>
                {summary.map((r) => {
                  const maxAbs = Math.max(1, ...summary.map((x) => Math.abs(x.total)));
                  const label = sumBy === "month" && /^\d{4}-\d{2}$/.test(r.key) ? new Date(Number(r.key.slice(0, 4)), Number(r.key.slice(5, 7)) - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" }) : r.key;
                  const clickable = sumBy !== "month" && r.key !== "Senza fornitore";
                  return (
                    <tr key={r.key} className={`border-b border-line last:border-0 ${clickable ? "cursor-pointer hover:bg-wash" : ""}`} onClick={clickable ? () => { if (sumBy === "supplier") setSupF(r.key); else setCatF(r.key === "Senza categoria" ? "none" : r.key); setView("elenco"); } : undefined}>
                      <td className="px-3 py-2 font-medium capitalize text-txt">{label}</td>
                      <td className="px-3 py-2 text-right font-mono text-dim">{r.count}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-dim">{eur(cents(r.taxable))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-dim">{eur(cents(r.vat))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-txt">{eur(cents(r.total))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono" style={{ color: r.unpaid > 0 ? "var(--warn)" : "var(--faint)" }}>{eur(cents(r.unpaid))}</td>
                      <td className="px-3 py-2"><div className="h-2 w-full rounded-full bg-wash"><div className="h-2 rounded-full" style={{ width: `${Math.round((Math.abs(r.total) / maxAbs) * 100)}%`, backgroundColor: r.total < 0 ? "var(--ok)" : "var(--focus)" }} /></div></td>
                    </tr>
                  );
                })}
                {summary.length === 0 && <tr><td colSpan={7}><EmptyState title="Nessun dato da riepilogare" sub="Cambia i filtri o registra una fattura." /></td></tr>}
                {summary.length > 0 && <tr className="border-t border-line bg-wash/50 font-semibold"><td className="px-3 py-2 text-txt">Totale</td><td className="px-3 py-2 text-right font-mono text-dim">{filtered.length}</td><td className="px-3 py-2 text-right font-mono text-dim">{eur(cents(totals.imp))}</td><td className="px-3 py-2 text-right font-mono text-dim">{eur(cents(totals.iva))}</td><td className="px-3 py-2 text-right font-mono text-txt">{eur(cents(totals.tot))}</td><td className="px-3 py-2 text-right font-mono" style={{ color: totals.unpaid > 0 ? "var(--warn)" : "var(--faint)" }}>{eur(cents(totals.unpaid))}</td><td /></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {view === "elenco" && sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-wash px-3 py-2 text-sm">
          <span className="font-semibold text-txt">{sel.size} selezionat{sel.size === 1 ? "o" : "i"}</span>
          <button onClick={bulkPaid} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Segna come pagate</button>
          <button onClick={() => registerCash(filtered.filter((r) => sel.has(r.id) && r.paid))} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash" title="Crea in Cassa il movimento di uscita dei documenti pagati selezionati">Registra in Cassa</button>
          <button onClick={() => setSel(new Set())} className="ml-auto text-xs font-semibold text-dim hover:text-txt">Annulla selezione</button>
        </div>
      )}

      {view === "elenco" && (
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Seleziona tutte" checked={filtered.length > 0 && filtered.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())} /></th>
              <th className="cursor-pointer select-none px-3 py-2 font-semibold hover:text-txt" onClick={() => sortBy("doc_date")}>Data{arrow("doc_date")}</th>{!single && <th className="px-3 py-2 font-semibold">Struttura</th>}<th className="cursor-pointer select-none px-3 py-2 font-semibold hover:text-txt" onClick={() => sortBy("supplier_name")}>Fornitore{arrow("supplier_name")}</th><th className="px-3 py-2 font-semibold">Numero</th><th className="px-3 py-2 font-semibold">Tipo</th><th className="px-3 py-2 font-semibold">Categoria</th><th className="px-3 py-2 text-right font-semibold">Imponibile</th><th className="px-3 py-2 text-right font-semibold">IVA</th><th className="cursor-pointer select-none px-3 py-2 text-right font-semibold hover:text-txt" onClick={() => sortBy("total_cents")}>Totale{arrow("total_cents")}</th><th className="cursor-pointer select-none px-3 py-2 font-semibold hover:text-txt" onClick={() => sortBy("due_date")}>Scadenza{arrow("due_date")}</th><th className="px-3 py-2 font-semibold">Stato</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const overdue = r.due_date && r.due_date < t && !r.paid && r.doc_type !== "nota_credito";
              const credit = r.doc_type === "nota_credito";
              return (
                <tr key={r.id} onClick={() => openEdit(r)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Seleziona" checked={sel.has(r.id)} onChange={(e) => setSel((prev) => { const n = new Set(prev); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-dim">{r.doc_date ? new Date(r.doc_date).toLocaleDateString("it-IT") : "—"}</td>
                  {!single && <td className="px-3 py-2.5 text-dim">{structName(r.structure_id)}</td>}
                  <td className="px-3 py-2.5 font-medium text-txt">{r.supplier_name || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-dim">{r.doc_number || "—"}</td>
                  <td className="px-3 py-2.5 text-dim">{TIPI[r.doc_type]}</td>
                  <td className="px-3 py-2.5 text-dim">{r.category || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{eur(cents(signedCents(r, r.taxable_cents)))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-dim">{eur(cents(signedCents(r, r.vat_cents)))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-txt">{eur(cents(signedCents(r, r.total_cents)))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs" style={{ color: overdue ? "var(--err)" : "var(--dim)" }}>{r.due_date ? new Date(r.due_date).toLocaleDateString("it-IT") : "—"}</td>
                  <td className="px-3 py-2.5" onClick={(e) => { e.stopPropagation(); if (!credit) togglePaid(r); }}>
                    <span className={`${credit ? "" : "cursor-pointer"} rounded-full px-2 py-0.5 text-[11px] font-semibold`} style={{ backgroundColor: `color-mix(in srgb, ${r.paid ? "var(--ok)" : overdue ? "var(--err)" : "var(--warn)"} 16%, transparent)`, color: r.paid ? "var(--ok)" : overdue ? "var(--err)" : "var(--warn)" }}>{r.paid ? "Pagata" : overdue ? "Scaduta" : "Da pagare"}</span>
                    {inCassa.has(r.id) && <span className="ml-1.5 rounded-full bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-dim" title="Registrata in Cassa">Cassa</span>}
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && <tr><td colSpan={12}><EmptyState title={filtersActive ? "Nessuna fattura con questi filtri" : "Nessuna fattura passiva"} sub={filtersActive ? "Prova ad azzerare i filtri." : "Registra la prima con “+ Nuova fattura”."} /></td></tr>}
            {loading && <tr><td colSpan={12} className="px-3 py-10 text-center text-sm text-faint">Caricamento…</td></tr>}
          </tbody>
        </table>
      </div>
      )}

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
              {single ? (
                <div className="sm:col-span-2"><span className={lbl}>Struttura</span><div className="mt-1 rounded-lg border border-line bg-wash px-3 py-2 text-sm text-txt">{structName(activeStructureId)}</div></div>
              ) : (
                <label className={`${lbl} sm:col-span-2`}>Struttura
                  <select value={edit.structureId} onChange={(e) => setEdit({ ...edit, structureId: e.target.value })} className={inp}>
                    <option value="">— scegli —</option>
                    {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    <option value="common">Comune a tutte le strutture</option>
                  </select>
                </label>
              )}
              <label className={`${lbl} sm:col-span-2`}>Fornitore
                <input list="sup-list" value={edit.supplierName} onChange={(e) => { const name = e.target.value; const last = !edit.id && !edit.category ? docs.find((d) => (d.supplier_name ?? "").trim().toLowerCase() === name.trim().toLowerCase() && d.category) : undefined; setEdit({ ...edit, supplierName: name, supplierId: null, category: last?.category ?? edit.category }); }} className={inp} placeholder="Nome fornitore" />
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
            {edit.id && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-wash/50 p-3">
                <span className="text-sm font-semibold text-txt">Cassa</span>
                {inCassa.has(edit.id)
                  ? (<><span className="text-xs text-dim">Registrata in Cassa come uscita.</span><button onClick={async () => { await unregisterCash(edit.id); setEdit(null); }} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Rimuovi dalla Cassa</button></>)
                  : edit.paid
                    ? (<><span className="text-xs text-dim">Non ancora in Cassa. Salva prima eventuali modifiche.</span><button onClick={async () => { const d = docs.find((x) => x.id === edit.id); if (d) { await registerCash([d]); setEdit(null); } }} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Registra in Cassa</button></>)
                    : <span className="text-xs text-faint">Segna la fattura come pagata per poterla registrare in Cassa.</span>}
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
