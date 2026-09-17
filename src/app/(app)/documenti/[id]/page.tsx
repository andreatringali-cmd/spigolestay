"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { useData } from "@/lib/store";
import { useConfirm } from "@/components/ConfirmProvider";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { eur } from "@/lib/format";
import { nights } from "@/lib/dates";
import { cityTaxOf } from "@/lib/booking";
import { invPost, centsEur, DOC_KIND_LABEL, STATO } from "@/lib/invoicing/client";
import { BOLLO_THRESHOLD_CENTS } from "@/lib/invoicing/folio";

interface Doc { id: string; tenant_id: string; structure_id: string | null; booking_id: string | null; booking_code: string | null;
  doc_kind: string; sdi_type: string; regime: string | null; number_label: string | null; stato: string; issue_date: string | null;
  due_date: string | null; payment_terms: string | null; payment_method: string | null; vat_exigibility: string | null; notes: string | null;
  counterpart: Record<string, string> | null; taxable_cents: number; vat_cents: number; out_of_scope_cents: number;
  bollo_cents: number; rounding_cents: number; total_cents: number; advance_cents: number; send_sdi: boolean; provider: string | null; provider_ref: string | null; related_document_id: string | null; }
interface DbLine { id: string; pos: number; description: string; qty: number; unit_price_cents: number; vat_rate: number; vat_nature: string | null; line_total_cents: number; source_kind: string | null }
interface Ev { id: string; ts: string; kind: string; message: string }
interface Pay { id: string; amount_cents: number; method: string | null; paid_at: string; note: string | null }
// Riga in editing (prezzo in euro per comodità dell'utente).
interface ELine { id?: string; description: string; qty: number; unitEur: number; vat: string; sourceKind: string }

const VAT_OPTS = [["22", "22%"], ["10", "10%"], ["4", "4%"], ["0", "0%"], ["N1", "Fuori campo (N1)"], ["N2.2", "Non sogg. (N2.2)"]] as const;
// OTA precaricate (dati anagrafici; la P.IVA va confermata secondo il contratto).
const OTA_PRESETS = [
  { name: "Booking.com B.V.", kind: "societa", country: "NL", vat: "NL805734958B01", address: "Herengracht 597", city: "Amsterdam", cap: "1017CE", province: "", sdi_code: "XXXXXXX" },
  { name: "Airbnb Ireland UC", kind: "societa", country: "IE", vat: "IE9827384L", address: "8 Hanover Quay", city: "Dublin", cap: "D02 K512", province: "", sdi_code: "XXXXXXX" },
  { name: "Expedia Lodging Partner Services Sàrl", kind: "societa", country: "CH", vat: "", address: "", city: "Ginevra", cap: "", province: "", sdi_code: "XXXXXXX" },
];
const num = (v: string) => { const n = Number(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };

export default function DocumentoPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const ask = useConfirm();
  const { structures, activeStructureId, bookings, getGuest, getStructure, getRoomType, updateBooking } = useData();
  const id = String(params.id || "");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  // Buffer di editing (solo in bozza)
  const [f, setF] = useState({ doc_kind: "fattura", sdi_type: "TD01", issue_date: "", due_date: "", payment_terms: "Pagamento completo", vat_exigibility: "I", payment_method: "Bonifico bancario", send_sdi: true, sdi_code: "0000000", pec: "", notes: "", rounding: false, bollo: false });
  const [cp, setCp] = useState({ kind: "privato", name: "", lastName: "", vat: "", tax_code: "", country: "IT", address: "", city: "", cap: "", province: "" });
  const [lines, setLines] = useState<ELine[]>([]);
  const [structureId, setStructureId] = useState("");
  const [link, setLink] = useState<{ bookingId: string | null; bookingCode: string | null }>({ bookingId: null, bookingCode: null });
  const [bookingPicker, setBookingPicker] = useState(false);
  const [bq, setBq] = useState("");
  const [vies, setVies] = useState<{ status?: string; msg?: string }>({});
  const [cpList, setCpList] = useState<{ id: string; kind: string; name: string; vat: string | null; tax_code: string | null; country: string | null; address: string | null; city: string | null; cap: string | null; province: string | null; sdi_code: string | null; pec: string | null }[]>([]);
  const [related, setRelated] = useState<{ id: string; number_label: string | null; doc_kind: string; role: string }[]>([]);

  const hydrate = useCallback((d: Doc, dl: DbLine[]) => {
    setF({
      doc_kind: d.doc_kind, sdi_type: d.sdi_type, issue_date: d.issue_date ?? new Date().toISOString().slice(0, 10),
      due_date: d.due_date ?? "", payment_terms: d.payment_terms ?? "Pagamento completo", vat_exigibility: d.vat_exigibility ?? "I",
      payment_method: d.payment_method ?? "Bonifico bancario", send_sdi: d.send_sdi, sdi_code: (d.counterpart?.sdi_code as string) ?? "0000000",
      pec: (d.counterpart?.pec as string) ?? "", notes: d.notes ?? "", rounding: (d.rounding_cents ?? 0) !== 0, bollo: (d.bollo_cents ?? 0) > 0,
    });
    const c = d.counterpart ?? {};
    setCp({ kind: c.kind ?? "privato", name: c.name ?? "", lastName: c.lastName ?? "", vat: c.vat ?? "", tax_code: c.tax_code ?? "", country: c.country ?? "IT", address: c.address ?? "", city: c.city ?? "", cap: c.cap ?? "", province: c.province ?? "" });
    setLines(dl.map((l) => ({ id: l.id, description: l.description, qty: Number(l.qty), unitEur: l.unit_price_cents / 100, vat: l.vat_nature ?? String(Number(l.vat_rate)), sourceKind: l.source_kind ?? "extra" })));
    setStructureId(d.structure_id ?? "");
    setLink({ bookingId: d.booking_id, bookingCode: d.booking_code });
  }, []);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const [d, l, e, p] = await Promise.all([
      supabase.from("documents").select("*").eq("id", id).maybeSingle(),
      supabase.from("document_lines").select("*").eq("document_id", id).order("pos"),
      supabase.from("document_events").select("*").eq("document_id", id).order("ts", { ascending: false }),
      supabase.from("document_payments").select("*").eq("document_id", id).order("paid_at"),
    ]);
    const dd = (d.data ?? null) as Doc | null;
    setDoc(dd); setEvents((e.data ?? []) as Ev[]); setPays((p.data ?? []) as Pay[]);
    if (dd) hydrate(dd, (l.data ?? []) as DbLine[]);
    // Documenti collegati: la fattura di origine (se questo è una NC) e le NC che stornano questo doc.
    if (dd) {
      const rel: { id: string; number_label: string | null; doc_kind: string; role: string }[] = [];
      if (dd.related_document_id) {
        const { data: src } = await supabase.from("documents").select("id, number_label, doc_kind").eq("id", dd.related_document_id).maybeSingle();
        if (src) rel.push({ ...(src as { id: string; number_label: string | null; doc_kind: string }), role: "Documento di origine" });
      }
      const { data: nc } = await supabase.from("documents").select("id, number_label, doc_kind").eq("related_document_id", dd.id);
      (nc ?? []).forEach((x) => rel.push({ ...(x as { id: string; number_label: string | null; doc_kind: string }), role: "Nota di credito" }));
      setRelated(rel);
    }
    setLoading(false);
  }, [id, hydrate]);
  useEffect(() => { load(); }, [load]);
  const loadCounterparts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("counterparts").select("id, kind, name, vat, tax_code, country, address, city, cap, province, sdi_code, pec").order("name");
    setCpList((data ?? []) as typeof cpList);
  }, []);
  useEffect(() => { loadCounterparts(); }, [loadCounterparts]);
  const applyCounterpart = (c: { kind?: string; name?: string; vat?: string | null; tax_code?: string | null; country?: string | null; address?: string | null; city?: string | null; cap?: string | null; province?: string | null; sdi_code?: string | null; pec?: string | null }) => {
    setCp({ kind: c.kind ?? "societa", name: c.name ?? "", lastName: "", vat: c.vat ?? "", tax_code: c.tax_code ?? "", country: c.country ?? "IT", address: c.address ?? "", city: c.city ?? "", cap: c.cap ?? "", province: c.province ?? "" });
    setF((p) => ({ ...p, sdi_code: c.sdi_code ?? p.sdi_code, pec: c.pec ?? "" }));
  };
  const saveCounterpart = async () => {
    if (!supabase || !user || !cp.name.trim()) return;
    const fullName = `${cp.name} ${cp.lastName}`.trim();
    const { error } = await supabase.from("counterparts").insert({ tenant_id: user.id, kind: cp.kind, name: fullName, vat: cp.vat || null, tax_code: cp.tax_code || null, country: cp.country || "IT", address: cp.address || null, city: cp.city || null, cap: cp.cap || null, province: cp.province || null, sdi_code: f.sdi_code || null, pec: f.pec || null });
    setMsg(error ? "Errore anagrafica: " + error.message : "Intestatario salvato in anagrafica ✓");
    if (!error) loadCounterparts();
  };
  // Se in alto è selezionata UNA struttura, il documento in bozza la eredita (menu nascosto).
  useEffect(() => {
    if (doc?.stato === "bozza" && activeStructureId !== "all" && structures.some((x) => x.id === activeStructureId)) {
      setStructureId((cur) => (cur === activeStructureId ? cur : activeStructureId));
    }
  }, [doc?.stato, activeStructureId, structures]);

  // Calcolo totali live dalle righe in editing.
  const totals = useMemo(() => {
    let taxable = 0, out = 0; const byRate: Record<number, number> = {};
    for (const l of lines) {
      const cents = Math.round(l.unitEur * 100 * (l.qty || 0));
      if (l.vat === "N1") { out += cents; continue; }
      taxable += cents;
      const rate = l.vat === "N2.2" ? 0 : Number(l.vat) || 0;
      if (rate > 0) byRate[rate] = (byRate[rate] ?? 0) + cents;
    }
    let vat = 0; for (const r of Object.keys(byRate)) vat += Math.round(byRate[Number(r)] * Number(r) / 100);
    const bolloCents = f.bollo ? 200 : 0;
    let total = taxable + vat + out + bolloCents;
    let roundingCents = 0;
    if (f.rounding) { const r = Math.round(total / 100) * 100; roundingCents = r - total; total = r; }
    return { taxable, vat, out, bolloCents, roundingCents, total };
  }, [lines, f.bollo, f.rounding]);

  const bolloEligible = doc?.regime === "forfettario" && (totals.taxable + totals.vat + totals.out) > BOLLO_THRESHOLD_CENTS;

  const paid = pays.reduce((a, p) => a + p.amount_cents, 0);
  const residuo = totals.total - paid;
  const frozen = !!doc && doc.stato !== "bozza";

  const setLine = (i: number, patch: Partial<ELine>) => setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = (preset: Partial<ELine>) => setLines((p) => [...p, { description: "", qty: 1, unitEur: 0, vat: "22", sourceKind: "extra", ...preset }]);
  const delLine = (i: number) => setLines((p) => p.filter((_, j) => j !== i));
  const delCityTax = () => setLines((p) => p.filter((l) => l.vat !== "N1" && l.sourceKind !== "city_tax"));

  const dmy = (iso: string) => { const [y, m, d] = (iso || "").split("-"); return d ? `${d}/${m}/${y}` : iso; };
  const attachBooking = (bid: string) => {
    const b = bookings.find((x) => x.id === bid); if (!b) return;
    const rt = getRoomType(b.roomTypeId); const structure = getStructure(b.structureId); const g = getGuest(b.guestId);
    const add: ELine[] = [];
    if (b.total) add.push({ description: `${(rt?.name ?? "Soggiorno").toUpperCase()} – ${dmy(b.checkIn)} al ${dmy(b.checkOut)}`, qty: 1, unitEur: b.total, vat: "10", sourceKind: "accommodation" });
    if (b.cleaningFee) add.push({ description: "Pulizia finale", qty: 1, unitEur: b.cleaningFee, vat: "10", sourceKind: "cleaning" });
    (b.extras ?? []).forEach((e) => { if (e?.price) add.push({ description: e.name || "Extra", qty: 1, unitEur: e.price, vat: "22", sourceKind: "extra" }); });
    const tax = cityTaxOf(structure, b.adults ?? 0, nights(b.checkIn, b.checkOut), b.total ?? 0, b.cityTaxExempt);
    if (tax) add.push({ description: "Imposta di soggiorno", qty: 1, unitEur: tax, vat: "N1", sourceKind: "city_tax" });
    setLines((p) => [...p, ...add]);
    setStructureId(b.structureId);
    setLink({ bookingId: b.id, bookingCode: b.code ?? null });
    const ir = b.invoiceRequest;
    if (ir?.wants) setCp({ kind: ir.kind ?? "privato", name: ir.name ?? "", lastName: "", vat: ir.vat ?? "", tax_code: ir.taxCode ?? "", country: ir.country ?? "IT", address: ir.address ?? "", city: ir.city ?? "", cap: ir.cap ?? "", province: ir.province ?? "" });
    else if (g && !cp.name) setCp((c) => ({ ...c, name: g.firstName ?? g.fullName, lastName: g.lastName ?? "" }));
    setBookingPicker(false);
  };
  const bookingList = useMemo(() => {
    const term = bq.trim().toLowerCase();
    return [...bookings].filter((b) => b.status !== "cancelled" && b.channel !== "blocked")
      .sort((a, b) => (b.checkIn || "").localeCompare(a.checkIn || ""))
      .filter((b) => { if (!term) return true; return `${getGuest(b.guestId)?.fullName ?? ""} ${b.code ?? ""}`.toLowerCase().includes(term); })
      .slice(0, 40);
  }, [bookings, bq, getGuest]);

  const saveDraft = async () => {
    if (!supabase || !user || !doc) return false;
    // Righe: elimino e reinserisco (solo in bozza è consentito dal trigger).
    await supabase.from("document_lines").delete().eq("document_id", id);
    if (lines.length) {
      await supabase.from("document_lines").insert(lines.map((l, i) => ({
        document_id: id, tenant_id: user.id, pos: i + 1, description: l.description || "—", qty: l.qty || 1,
        unit_price_cents: Math.round(l.unitEur * 100), vat_rate: l.vat === "N1" || l.vat === "N2.2" ? 0 : Number(l.vat) || 0,
        vat_nature: l.vat === "N1" ? "N1" : l.vat === "N2.2" ? "N2.2" : null,
        line_total_cents: Math.round(l.unitEur * 100 * (l.qty || 0)), source_kind: l.sourceKind, booking_id: doc.booking_id, folio_ref: `l${i}`,
      })));
    }
    const counterpart = { kind: cp.kind, name: cp.name, lastName: cp.lastName || undefined, vat: cp.vat || null, tax_code: cp.tax_code || null, country: cp.country || "IT", address: cp.address || null, city: cp.city || null, cap: cp.cap || null, province: cp.province || null, sdi_code: f.sdi_code || (cp.kind === "estero" ? "XXXXXXX" : "0000000"), pec: f.pec || null };
    const { error } = await supabase.from("documents").update({
      structure_id: structureId || null, serie: structureId || null, booking_id: link.bookingId, booking_code: link.bookingCode,
      doc_kind: f.doc_kind, sdi_type: f.doc_kind === "nota_di_credito" ? "TD04" : f.sdi_type, issue_date: f.issue_date || null, due_date: f.due_date || null,
      payment_terms: f.payment_terms, vat_exigibility: f.vat_exigibility, payment_method: f.payment_method, send_sdi: f.send_sdi, notes: f.notes || null,
      counterpart, taxable_cents: totals.taxable, vat_cents: totals.vat, out_of_scope_cents: totals.out, bollo_cents: totals.bolloCents,
      rounding_cents: totals.roundingCents, total_cents: totals.total,
    }).eq("id", id);
    if (error) { setMsg("Errore salvataggio: " + error.message); return false; }
    return true;
  };

  const act = async (label: string, fn: () => Promise<void>) => { setBusy(label); setMsg(""); try { await fn(); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); } };
  const onSave = () => act("save", async () => { if (await saveDraft()) setMsg("Bozza salvata ✓"); });
  const onIssue = () => act("issue", async () => { if (await saveDraft()) { await invPost("issue", { documentId: id }); setMsg("Documento emesso ✓"); } });
  const onSaveSend = () => act("savesend", async () => { if (await saveDraft()) { await invPost("issue", { documentId: id }); const r = await invPost<{ message?: string }>("send", { documentId: id }); setMsg(r.message || "Emesso e inviato"); } });
  const send = () => act("send", async () => { const r = await invPost<{ message?: string }>("send", { documentId: id }); if (r.message) setMsg(r.message); });
  const refresh = () => act("status", async () => { const r = await invPost<{ message?: string }>("status", { documentId: id }); if (r.message) setMsg(r.message); });
  const downloadXml = () => act("xml", async () => { const r = await invPost<{ xml: string }>("xml", { documentId: id }); const b = new Blob([r.xml], { type: "application/xml" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${(doc?.number_label ?? id).replace(/[^\w-]/g, "_")}.xml`; a.click(); URL.revokeObjectURL(a.href); });
  const creditNote = () => act("nc", async () => { const r = await invPost<{ documentId: string }>("credit-note", { documentId: id }); router.push(`/documenti/${r.documentId}`); });
  const verifyVies = async () => {
    if (!cp.vat.trim()) return;
    setVies({ status: "loading" });
    try {
      const r = await invPost<{ status: string; valid?: boolean; name?: string | null; address?: string | null; message?: string }>("vies", { vat: cp.vat });
      if (r.valid) { setVies({ status: "valid", msg: r.name || "P.IVA valida" }); if (r.name && !cp.name) setCp((c) => ({ ...c, name: r.name as string })); }
      else if (r.status === "invalid") setVies({ status: "invalid", msg: "P.IVA non valida" });
      else setVies({ status: "unknown", msg: r.message || "Verifica non disponibile" });
    } catch (e) { setVies({ status: "unknown", msg: e instanceof Error ? e.message : "Errore" }); }
  };
  const addPayment = async (amountCents: number, method: string) => {
    if (!supabase || !user || amountCents <= 0) return;
    await act("pay", async () => {
      await supabase!.from("document_payments").insert({ document_id: id, tenant_id: user.id, amount_cents: amountCents, method });
      // Fonte di verità = prenotazione: propaga l'incasso su booking.paid (in €).
      if (link.bookingId) { const b = bookings.find((x) => x.id === link.bookingId); if (b) updateBooking(b.id, { paid: (b.paid ?? 0) + Math.round(amountCents) / 100 }); }
    });
  };
  const deleteDraft = async () => {
    if (!supabase || !doc || doc.stato !== "bozza") return;
    if (!(await ask({ title: "Elimina bozza", message: "Eliminare questa bozza di documento?", danger: true, confirmLabel: "Elimina" }))) return;
    setBusy("del"); setMsg("");
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) { setMsg("Errore: " + error.message); setBusy(""); return; }
    router.push("/documenti");
  };

  const printPdf = async () => {
    if (!doc) return;
    const { data: se } = await supabase!.from("tenant_invoice_settings").select("*").maybeSingle();
    const e = (c: number) => eur(centsEur(c));
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const rows = lines.map((l) => `<tr><td>${esc(l.description)}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${l.vat === "N1" || l.vat === "N2.2" ? l.vat : l.vat + "%"}</td><td style="text-align:right">${eur(l.unitEur * (l.qty || 0))}</td></tr>`).join("");
    const emit = [se?.denominazione, se?.vat ? "P.IVA " + se.vat : "", se?.tax_code ? "CF " + se.tax_code : "", [se?.address, se?.cap, se?.city, se?.province].filter(Boolean).join(" "), se?.pec].filter(Boolean).map((x) => `<div>${esc(x)}</div>`).join("");
    const cli = [`${cp.name} ${cp.lastName}`.trim(), cp.vat ? "P.IVA " + cp.vat : "", cp.tax_code ? "CF " + cp.tax_code : "", [cp.address, cp.cap, cp.city, cp.province].filter(Boolean).join(" ")].filter(Boolean).map((x) => `<div>${esc(x)}</div>`).join("");
    const w = window.open("", "_blank", "width=820,height=1040"); if (!w) return;
    w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${doc.number_label ?? "Documento"}</title>
      <style>*{box-sizing:border-box}body{font-family:Georgia,serif;color:#1a2131;margin:0;padding:44px 52px;font-size:13px;line-height:1.5}
      .head{display:flex;justify-content:space-between;border-bottom:3px solid #285f92;padding-bottom:14px;margin-bottom:18px}.doc{font-size:22px;font-weight:700;color:#285f92}
      .p{display:flex;justify-content:space-between;gap:24px;margin:16px 0}.p h4{margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#5c6479}
      table{width:100%;border-collapse:collapse;margin-top:10px}th,td{padding:8px 6px;border-bottom:1px solid #e3e6ef}th{text-align:left;font-size:11px;text-transform:uppercase;color:#5c6479}
      .tot{margin:14px 0 0;margin-left:auto;width:280px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .g{border-top:2px solid #285f92;font-weight:700;font-size:15px;margin-top:6px;padding-top:8px}
      .note{margin-top:26px;font-size:11px;color:#7a8194;border-top:1px solid #e3e6ef;padding-top:12px}@media print{body{padding:24px 30px}}</style></head><body>
      <div class="head"><div>${emit || '<div>Emittente da configurare</div>'}</div><div style="text-align:right"><div class="doc">${DOC_KIND_LABEL[doc.doc_kind]}</div><div>n. ${doc.number_label ?? "(bozza)"}</div><div>${f.issue_date ? new Date(f.issue_date).toLocaleDateString("it-IT") : ""}</div></div></div>
      <div class="p"><div><h4>Cliente</h4>${cli}</div>${doc.booking_code ? `<div style="text-align:right"><h4>Prenotazione</h4><div>${esc(doc.booking_code)}</div></div>` : ""}</div>
      <table><thead><tr><th>Descrizione</th><th style="text-align:right">Q.tà</th><th style="text-align:right">IVA</th><th style="text-align:right">Totale</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot"><div><span>Imponibile</span><span>${e(totals.taxable)}</span></div><div><span>IVA</span><span>${e(totals.vat)}</span></div>${totals.out ? `<div><span>Fuori campo IVA (art.15)</span><span>${e(totals.out)}</span></div>` : ""}${totals.bolloCents ? `<div><span>Bollo</span><span>${e(totals.bolloCents)}</span></div>` : ""}<div class="g"><span>Totale</span><span>${e(totals.total)}</span></div></div>
      <div class="note">${se?.regime_note ? esc(se.regime_note) + "<br>" : ""}${esc(se?.footer_note ?? "")}<br>Documento di cortesia.</div></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };

  if (loading) return <div className="p-6 text-sm text-faint">Caricamento…</div>;
  if (!doc) return <div className="p-6 text-sm text-faint">Documento non trovato. <button onClick={() => router.push("/documenti")} className="font-semibold text-focus hover:underline">Torna ai documenti</button></div>;

  const st = STATO[doc.stato] ?? { label: doc.stato, color: "var(--dim)" };
  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";
  const e2 = (c: number) => eur(centsEur(c));
  const setDue = (days: number) => setF((p) => ({ ...p, due_date: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) }));

  return (
    <div>
      <PageHeader title={`${DOC_KIND_LABEL[doc.doc_kind] ?? "Documento"} ${doc.number_label ?? "(bozza)"}`}
        subtitle={doc.booking_code ? `Prenotazione ${doc.booking_code}` : undefined}
        actions={<button onClick={() => router.push("/documenti")} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">← Documenti</button>} />

      {frozen && <div className="mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white" style={{ backgroundColor: "var(--err)" }}>🔒 Le informazioni fiscali non sono più modificabili ({st.label.toLowerCase()}). Per correggere si emette una nota di credito.</div>}
      {msg && <Card className="mb-4"><p className="text-sm text-dim">{msg}</p></Card>}

      {bookingPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Chiudi" onClick={() => setBookingPicker(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-2 flex items-center justify-between"><span className="text-lg font-bold text-txt">Collega una prenotazione</span><button onClick={() => setBookingPicker(false)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <input value={bq} onChange={(e) => setBq(e.target.value)} placeholder="Cerca ospite o codice…" className={inp} autoFocus />
            <div className="mt-2 flex-1 overflow-y-auto">
              {bookingList.map((b) => (
                <button key={b.id} onClick={() => attachBooking(b.id)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left hover:border-focus hover:bg-wash">
                  <div className="min-w-0"><div className="truncate text-sm font-medium text-txt">{getGuest(b.guestId)?.fullName || "Ospite"} <span className="text-faint">· {b.code}</span></div><div className="text-[11px] text-faint">{new Date(b.checkIn).toLocaleDateString("it-IT")}–{new Date(b.checkOut).toLocaleDateString("it-IT")}</div></div>
                  <span className="shrink-0 font-mono text-sm text-txt">{eur(b.total ?? 0)}</span>
                </button>
              ))}
              {bookingList.length === 0 && <p className="py-6 text-center text-sm text-faint">Nessuna prenotazione.</p>}
            </div>
            <p className="mt-2 text-[11px] text-faint">Collegando la prenotazione, le righe del folio (soggiorno, pulizia, extra, tassa) vengono aggiunte alle voci.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* FATTURA */}
        <Card>
          <SectionTitle>Documento</SectionTitle>
          {frozen ? (
            <div className="mt-2 space-y-1 text-sm text-dim">
              <div>Tipo: <b className="text-txt">{DOC_KIND_LABEL[doc.doc_kind]}</b> · {doc.sdi_type}</div>
              <div>Numero: <b className="text-txt">{doc.number_label}</b> · {doc.issue_date && new Date(doc.issue_date).toLocaleDateString("it-IT")}</div>
              <div>Pagamento: {doc.payment_method} · scad. {doc.due_date ? new Date(doc.due_date).toLocaleDateString("it-IT") : "—"}</div>
            </div>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {activeStructureId === "all"
                ? <label className={lbl}>Struttura<select value={structureId} onChange={(e) => setStructureId(e.target.value)} className={inp}><option value="">— scegli —</option>{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                : <div><span className={lbl}>Struttura</span><div className="mt-1 rounded-lg border border-line bg-wash px-3 py-2 text-sm text-txt">{structures.find((x) => x.id === structureId)?.name ?? "—"}</div></div>}
              <div><span className={lbl}>Prenotazione <span className="text-faint">(facoltativa)</span></span>
                <div className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-lg border border-line bg-wash px-3 py-2 text-sm text-txt">{link.bookingCode ?? "nessuna"}</span>
                  <button type="button" onClick={() => { setBq(""); setBookingPicker(true); }} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-txt hover:bg-wash">Collega</button>
                  {link.bookingId && <button type="button" onClick={() => setLink({ bookingId: null, bookingCode: null })} className="shrink-0 text-faint hover:text-[color:var(--err)]">✕</button>}
                </div>
              </div>
              <label className={lbl}>Tipologia<select value={f.doc_kind} onChange={(e) => setF({ ...f, doc_kind: e.target.value })} className={inp}><option value="fattura">Fattura</option><option value="nota_di_credito">Nota di credito</option><option value="ricevuta_non_fiscale">Ricevuta</option></select></label>
              <label className={lbl}>Data emissione<input type="date" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} className={inp} /></label>
              <div><span className={lbl}>Scadenza pagamento</span><div className="mt-1 flex gap-1"><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} className="w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt" />{[30, 60, 120].map((d) => <button key={d} onClick={() => setDue(d)} className="shrink-0 rounded-lg bg-wash px-2 text-xs font-semibold text-dim hover:bg-line">+{d}</button>)}</div></div>
              <label className={lbl}>Metodo di pagamento<select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })} className={inp}><option>Bonifico bancario</option><option>Carta</option><option>Contanti</option><option>PayPal</option><option>Assegno</option></select></label>
              <details className="sm:col-span-2 mt-1">
                <summary className="cursor-pointer text-xs font-semibold text-focus">Altre opzioni</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <label className={lbl}>Tipo doc. SDI<select value={f.sdi_type} onChange={(e) => setF({ ...f, sdi_type: e.target.value })} className={inp}><option value="TD01">TD01 - Fattura</option><option value="TD04">TD04 - Nota di credito</option><option value="TD16">TD16 - Autofattura</option></select></label>
                  <label className={lbl}>Condizioni pagamento<select value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })} className={inp}><option>Pagamento completo</option><option>Acconto</option><option>Pagamento a rate</option></select></label>
                  <label className={lbl}>Esigibilità IVA<select value={f.vat_exigibility} onChange={(e) => setF({ ...f, vat_exigibility: e.target.value })} className={inp}><option value="I">Immediata</option><option value="D">Differita</option><option value="S">Scissione pagamenti</option></select></label>
                </div>
              </details>
            </div>
          )}
        </Card>

        {/* VOCI */}
        <Card>
          <SectionTitle>Voci del documento</SectionTitle>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="py-1.5 pr-2 font-semibold">Descrizione</th><th className="py-1.5 px-1 text-right font-semibold">Q.tà</th><th className="py-1.5 px-1 text-right font-semibold">Prezzo</th><th className="py-1.5 px-1 font-semibold">IVA</th><th className="py-1.5 pl-1 text-right font-semibold">Totale</th>{!frozen && <th></th>}</tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {frozen ? <td className="py-2 pr-2 text-txt">{l.description}</td> : <td className="py-1 pr-2"><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className="w-full rounded border border-line bg-paper px-2 py-1 text-sm" /></td>}
                    {frozen ? <td className="py-2 px-1 text-right font-mono text-dim">{l.qty}</td> : <td className="py-1 px-1"><input value={l.qty} onChange={(e) => setLine(i, { qty: num(e.target.value) })} className="w-14 rounded border border-line bg-paper px-1 py-1 text-right text-sm" /></td>}
                    {frozen ? <td className="py-2 px-1 text-right font-mono text-dim">{eur(l.unitEur)}</td> : <td className="py-1 px-1"><input value={l.unitEur} onChange={(e) => setLine(i, { unitEur: num(e.target.value) })} className="w-20 rounded border border-line bg-paper px-1 py-1 text-right text-sm" /></td>}
                    {frozen ? <td className="py-2 px-1 text-dim">{l.vat === "N1" || l.vat === "N2.2" ? l.vat : l.vat + "%"}</td> : <td className="py-1 px-1"><select value={l.vat} onChange={(e) => setLine(i, { vat: e.target.value })} className="rounded border border-line bg-paper px-1 py-1 text-sm">{VAT_OPTS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></td>}
                    <td className="py-1 pl-1 text-right font-mono text-txt">{eur(l.unitEur * (l.qty || 0))}</td>
                    {!frozen && <td className="py-1 pl-1 text-right"><button onClick={() => delLine(i)} className="text-faint hover:text-[color:var(--err)]">✕</button></td>}
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-sm text-faint">Nessuna voce.</td></tr>}
              </tbody>
            </table>
          </div>
          {!frozen && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button onClick={() => addLine({ description: "", vat: "22", sourceKind: "extra" })} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash">+ Riga</button>
              <button onClick={() => addLine({ description: "Imposta di soggiorno", vat: "N1", sourceKind: "city_tax" })} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash">+ Tassa soggiorno</button>
              <button onClick={delCityTax} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-[color:var(--err)] hover:bg-wash">Elimina tasse soggiorno</button>
            </div>
          )}
          <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between"><span className="text-dim">Imponibile</span><span className="font-mono">{e2(totals.taxable)}</span></div>
            <div className="flex justify-between"><span className="text-dim">IVA</span><span className="font-mono">{e2(totals.vat)}</span></div>
            {totals.out > 0 && <div className="flex justify-between"><span className="text-dim">Fuori campo IVA (art.15)</span><span className="font-mono">{e2(totals.out)}</span></div>}
            {!frozen && (
              <div className="flex items-center justify-between"><span className="text-dim">Bollo virtuale {bolloEligible ? "(dovuto)" : ""}</span><label className="inline-flex cursor-pointer items-center gap-1"><input type="checkbox" checked={f.bollo} onChange={(e) => setF({ ...f, bollo: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /><span className="font-mono">{e2(totals.bolloCents)}</span></label></div>
            )}
            {frozen && totals.bolloCents > 0 && <div className="flex justify-between"><span className="text-dim">Bollo</span><span className="font-mono">{e2(totals.bolloCents)}</span></div>}
            {!frozen && <label className="flex items-center justify-between"><span className="text-dim">Arrotonda all'euro</span><input type="checkbox" checked={f.rounding} onChange={(e) => setF({ ...f, rounding: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>}
            <div className="flex justify-between border-t border-line pt-1 text-base font-bold"><span>Totale</span><span className="font-mono">{e2(totals.total)}</span></div>
          </div>
        </Card>

        {/* INTESTAZIONE */}
        <Card>
          <SectionTitle>Intestazione</SectionTitle>
          {frozen ? (
            <div className="mt-2 space-y-1 text-sm"><div className="font-semibold text-txt">{cp.name} {cp.lastName}</div>{cp.vat && <div className="text-dim">P.IVA {cp.vat}</div>}{cp.tax_code && <div className="text-dim">CF {cp.tax_code}</div>}<div className="text-dim">{[cp.address, cp.cap, cp.city, cp.province].filter(Boolean).join(" ")}</div><div className="text-faint">Cod. dest. {f.sdi_code}{f.pec ? ` · PEC ${f.pec}` : ""}</div></div>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2 flex flex-wrap items-end gap-2">
                <label className="flex-1"><span className={lbl}>Scegli da anagrafica / OTA</span>
                  <select value="" onChange={(e) => { const v = e.target.value; if (v.startsWith("cp:")) { const c = cpList.find((x) => x.id === v.slice(3)); if (c) applyCounterpart(c); } else if (v.startsWith("ota:")) applyCounterpart(OTA_PRESETS[Number(v.slice(4))]); }} className={inp}>
                    <option value="">— nuovo intestatario —</option>
                    {cpList.length > 0 && <optgroup label="Anagrafica">{cpList.map((c) => <option key={c.id} value={`cp:${c.id}`}>{c.name}</option>)}</optgroup>}
                    <optgroup label="OTA">{OTA_PRESETS.map((o, i) => <option key={i} value={`ota:${i}`}>{o.name}</option>)}</optgroup>
                  </select>
                </label>
                <button type="button" onClick={saveCounterpart} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-txt hover:bg-wash">Salva in anagrafica</button>
              </div>
              <label className={`${lbl} sm:col-span-2`}>Tipologia persona<select value={cp.kind} onChange={(e) => setCp({ ...cp, kind: e.target.value })} className={inp}><option value="privato">Privato</option><option value="societa">Società</option><option value="estero">Estero</option><option value="ota">OTA</option></select></label>
              <label className={cp.kind === "privato" ? lbl : `${lbl} sm:col-span-2`}>{cp.kind === "societa" ? "Ragione sociale" : "Nome"}<input value={cp.name} onChange={(e) => setCp({ ...cp, name: e.target.value })} className={inp} /></label>
              {cp.kind === "privato" && <label className={lbl}>Cognome<input value={cp.lastName} onChange={(e) => setCp({ ...cp, lastName: e.target.value })} className={inp} /></label>}
              <label className={lbl}>Nazione<input value={cp.country} onChange={(e) => setCp({ ...cp, country: e.target.value })} className={inp} /></label>
              {cp.kind !== "privato" && <div><span className={lbl}>Partita IVA</span><div className="mt-1 flex gap-1"><input value={cp.vat} onChange={(e) => { setCp({ ...cp, vat: e.target.value }); setVies({}); }} className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /><button type="button" onClick={verifyVies} className="shrink-0 rounded-lg border border-line px-2 text-xs font-semibold text-txt hover:bg-wash">VIES</button></div>{vies.status && vies.status !== "loading" && <span className="mt-0.5 block text-[11px] font-semibold" style={{ color: vies.status === "valid" ? "var(--ok)" : vies.status === "invalid" ? "var(--err)" : "var(--dim)" }}>{vies.status === "valid" ? "✓ " : vies.status === "invalid" ? "✕ " : ""}{vies.msg}</span>}{vies.status === "loading" && <span className="mt-0.5 block text-[11px] text-faint">Verifica…</span>}</div>}
              {cp.kind === "privato" && <label className={lbl}>Codice fiscale<input value={cp.tax_code} onChange={(e) => setCp({ ...cp, tax_code: e.target.value })} className={inp} /></label>}
              <label className={`${lbl} sm:col-span-2`}>Indirizzo<input value={cp.address} onChange={(e) => setCp({ ...cp, address: e.target.value })} className={inp} /></label>
              <label className={lbl}>Città<input value={cp.city} onChange={(e) => setCp({ ...cp, city: e.target.value })} className={inp} /></label>
              <div className="grid grid-cols-2 gap-2"><label className={lbl}>CAP<input value={cp.cap} onChange={(e) => setCp({ ...cp, cap: e.target.value })} className={inp} /></label><label className={lbl}>Prov.<input value={cp.province} onChange={(e) => setCp({ ...cp, province: e.target.value })} className={inp} /></label></div>
              <div className="sm:col-span-2 mt-1 border-t border-line pt-2">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Fattura elettronica</div>
                <label className="flex items-center justify-between"><span className="text-sm text-txt">Comunica documento al SDI</span><input type="checkbox" checked={f.send_sdi} onChange={(e) => setF({ ...f, send_sdi: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>
                <div className="mt-2 grid grid-cols-2 gap-2"><label className={lbl}>Codice destinatario<input value={f.sdi_code} onChange={(e) => setF({ ...f, sdi_code: e.target.value })} className={inp} /></label><label className={lbl}>PEC<input value={f.pec} onChange={(e) => setF({ ...f, pec: e.target.value })} className={inp} /></label></div>
              </div>
            </div>
          )}
        </Card>

        {/* STATO + INCASSI */}
        <Card>
          <div className="mb-2 flex items-center justify-between"><SectionTitle>Stato e incassi</SectionTitle><span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</span></div>
          <div className="flex flex-col gap-1.5">
            {events.map((ev) => <div key={ev.id} className="flex gap-2 text-[13px]"><span className="w-24 shrink-0 text-[11px] text-faint">{new Date(ev.ts).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><span className="text-txt">{ev.message}</span></div>)}
          </div>
          <div className="mt-3 border-t border-line pt-2">
            <div className="mb-1 flex items-center justify-between"><span className="text-sm font-semibold text-txt">Incassi</span>{residuo > 0 ? <span className="text-[11px] font-semibold text-[color:var(--warn)]">Residuo {e2(residuo)}</span> : <span className="text-[11px] font-semibold text-[color:var(--ok)]">Saldato ✓</span>}</div>
            {pays.map((p) => <div key={p.id} className="flex justify-between text-sm text-dim"><span>{new Date(p.paid_at).toLocaleDateString("it-IT")} · {p.method}</span><span className="font-mono">{e2(p.amount_cents)}</span></div>)}
            {residuo > 0 && <button onClick={() => addPayment(residuo, "manuale")} disabled={!!busy} className="mt-2 rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Incassa tutto ({e2(residuo)})</button>}
          </div>
          {related.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Documenti collegati</div>
              {related.map((r) => (
                <button key={r.id} onClick={() => router.push(`/documenti/${r.id}`)} className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-wash">
                  <span className="text-dim">{r.role}</span>
                  <span className="font-semibold text-focus">{DOC_KIND_LABEL[r.doc_kind] ?? "Doc"} {r.number_label ?? "(bozza)"} ↗</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* AZIONI */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        {!frozen && <>
          <button onClick={onSave} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "save" ? "Salvo…" : "Salva bozza"}</button>
          <button onClick={onIssue} disabled={!!busy} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "issue" ? "Emissione…" : "Emetti"}</button>
          {f.send_sdi && f.doc_kind !== "ricevuta_non_fiscale" && <button onClick={onSaveSend} disabled={!!busy} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "savesend" ? "…" : "Salva e invia"}</button>}
          <button onClick={deleteDraft} disabled={!!busy} className="rounded-lg px-3 py-2 text-sm font-medium text-faint hover:text-[color:var(--err)] disabled:opacity-50">{busy === "del" ? "Elimino…" : "Elimina bozza"}</button>
        </>}
        {doc.stato === "emessa" && doc.send_sdi && <button onClick={send} disabled={!!busy} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "send" ? "Invio…" : "Invia allo SdI"}</button>}
        {doc.stato === "inviata_intermediario" && <button onClick={refresh} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "status" ? "Controllo…" : "Aggiorna esito"}</button>}
        <button onClick={printPdf} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash">Stampa PDF</button>
        {doc.provider_ref && <button onClick={downloadXml} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "xml" ? "…" : "Scarica XML"}</button>}
        {frozen && doc.doc_kind !== "nota_di_credito" && doc.stato !== "stornata" && <button onClick={creditNote} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-[color:var(--err)] hover:bg-wash disabled:opacity-50">{busy === "nc" ? "…" : "Nota di credito"}</button>}
        <span className="ml-auto text-[11px] text-faint">Regime: {doc.regime ?? "—"} · {doc.send_sdi ? "SDI attivo" : "no SDI"}</span>
      </div>
    </div>
  );
}
