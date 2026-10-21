"use client";

import DateField from "@/components/DateField";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { useData } from "@/lib/store";
import { useConfirm } from "@/components/ConfirmProvider";
import { PageHeader, Card, SectionTitle, Modal, Button } from "@/components/ui";
import { eur } from "@/lib/format";
import { roundCents } from "@/lib/money";
import { balanceDue } from "@/lib/incassi";
import { nights, fmtDate, fmtDateTime } from "@/lib/dates";
import { cityTaxOfBooking } from "@/lib/booking";
import { invPost, centsEur, DOC_KIND_LABEL, STATO } from "@/lib/invoicing/client";
import { BOLLO_THRESHOLD_CENTS } from "@/lib/invoicing/folio";
import { validateDocument, hasErrors, type Issue } from "@/lib/invoicing/validate";
import { sendAction, sendButtonLabel, sendConfirmText, isTrialSend, rejectionReason, sdiBadge, TRIAL_NOTE, eventDisplay } from "@/lib/invoicing/sdi-status";
import { useTenantId } from "@/lib/tenant";
import { todayRome } from "@/lib/dates-rome";
import NumInput from "@/components/NumInput";
import { parseDecimalIT } from "@/lib/num-it";
import { cashScopeOf } from "@/lib/cassa";
import { friendlyError } from "@/lib/friendly-error";

interface Doc { id: string; tenant_id: string; structure_id: string | null; booking_id: string | null; booking_code: string | null;
  doc_kind: string; sdi_type: string; regime: string | null; number_label: string | null; stato: string; issue_date: string | null;
  due_date: string | null; payment_terms: string | null; payment_method: string | null; vat_exigibility: string | null; notes: string | null;
  counterpart: Record<string, string> | null; taxable_cents: number; vat_cents: number; out_of_scope_cents: number;
  bollo_cents: number; rounding_cents: number; total_cents: number; advance_cents: number; send_sdi: boolean; provider: string | null; provider_ref: string | null; related_document_id: string | null; }
interface DbLine { id: string; pos: number; description: string; qty: number; unit_price_cents: number; vat_rate: number; vat_nature: string | null; line_total_cents: number; source_kind: string | null }
interface Ev { id: string; ts: string; kind: string; message: string; meta?: Record<string, unknown> | null }
interface Pay { id: string; amount_cents: number; method: string | null; paid_at: string; note: string | null }
interface Related { id: string; number_label: string | null; doc_kind: string; role: string; stato?: string; total_cents?: number }
// Dati emittente letti da tenant_invoice_settings (per account).
interface IssuerInfo { denominazione: string | null; vat: string | null; tax_code: string | null; address: string | null; city: string | null; cap: string | null; province: string | null; pec: string | null; regime_note: string | null; footer_note: string | null; bollo_auto: boolean | null }
const CREDIT_VALID = new Set(["emessa", "inviata_intermediario", "consegnata"]);
// Aliquota di default per le nuove righe, secondo il regime con cui è stato creato il documento.
const defaultVat = (regime: string | null | undefined, base: string) => regime === "forfettario" ? "N2.2" : regime === "non_imprenditoriale" ? "0" : base;
// Riga in editing (prezzo in euro per comodità dell'utente).
interface ELine { id?: string; description: string; qty: number; unitEur: number; vat: string; sourceKind: string }

const VAT_OPTS = [["22", "22%"], ["10", "10%"], ["4", "4%"], ["0", "0%"], ["N1", "Fuori campo (N1)"], ["N2.2", "Non sogg. (N2.2)"]] as const;
// OTA precaricate (dati anagrafici; la P.IVA va confermata secondo il contratto).
const OTA_PRESETS = [
  { name: "Booking.com B.V.", kind: "societa", country: "NL", vat: "NL805734958B01", address: "Herengracht 597", city: "Amsterdam", cap: "1017CE", province: "", sdi_code: "XXXXXXX" },
  { name: "Airbnb Ireland UC", kind: "societa", country: "IE", vat: "IE9827384L", address: "8 Hanover Quay", city: "Dublin", cap: "D02 K512", province: "", sdi_code: "XXXXXXX" },
  { name: "Expedia Lodging Partner Services Sàrl", kind: "societa", country: "CH", vat: "", address: "", city: "Ginevra", cap: "", province: "", sdi_code: "XXXXXXX" },
];

export default function DocumentoPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = useTenantId(); // account di lavoro: per un collaboratore è quello di chi lo ha invitato
  const ask = useConfirm();
  // `structures` = elenco COMPLETO: il documento può appartenere a una struttura fuori dalla selezione corrente.
  const { allStructures: structures, selectedStructureIds, raw, bookings, getGuest, getStructure, getRoomType, updateBooking } = useData();
  // Ambito dalla selezione vera (con 2+ strutture scelte `activeStructureId` del contesto resta "all"): una sola struttura = il suo id, altrimenti "all".
  const activeStructureId = useMemo(() => { const s = cashScopeOf(selectedStructureIds, structures.map((x) => x.id)); return typeof s === "string" ? s : "all"; }, [selectedStructureIds, structures]);
  const id = String(params.id || "");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [ficNote, setFicNote] = useState<{ ok: boolean; text: string } | null>(null);
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
  const [related, setRelated] = useState<Related[]>([]);
  const [issuer, setIssuer] = useState<IssuerInfo | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [payMethod, setPayMethod] = useState("Bonifico bancario");
  const bolloTouched = useRef(false);

  const hydrate = useCallback((d: Doc, dl: DbLine[]) => {
    setF({
      doc_kind: d.doc_kind, sdi_type: d.sdi_type, issue_date: d.issue_date ?? todayRome(),
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
      const rel: Related[] = [];
      if (dd.related_document_id) {
        const { data: src } = await supabase.from("documents").select("id, number_label, doc_kind, stato, total_cents").eq("id", dd.related_document_id).maybeSingle();
        if (src) rel.push({ ...(src as Omit<Related, "role">), role: "Documento di origine" });
      }
      const { data: nc } = await supabase.from("documents").select("id, number_label, doc_kind, stato, total_cents").eq("related_document_id", dd.id);
      (nc ?? []).forEach((x) => rel.push({ ...(x as Omit<Related, "role">), role: "Nota di credito" }));
      setRelated(rel);
    }
    setLoading(false);
  }, [id, hydrate]);
  useEffect(() => { load(); }, [load]);
  // Dati emittente dell'account di lavoro (filtrati per tenant: un collaboratore potrebbe vedere due righe).
  useEffect(() => {
    if (!supabase || !tenantId) return;
    let off = false;
    void Promise.resolve(supabase.from("tenant_invoice_settings").select("denominazione, vat, tax_code, address, city, cap, province, pec, regime_note, footer_note, bollo_auto").eq("tenant_id", tenantId).maybeSingle())
      .then(({ data }) => { if (!off) setIssuer((data ?? null) as IssuerInfo | null); });
    return () => { off = true; };
  }, [tenantId]);
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
    if (!tenantId) { setMsg("Account di lavoro non ancora caricato: riprova tra qualche secondo."); return; }
    const fullName = `${cp.name} ${cp.lastName}`.trim();
    const { error } = await supabase.from("counterparts").insert({ tenant_id: tenantId, kind: cp.kind, name: fullName, vat: cp.vat || null, tax_code: cp.tax_code || null, country: cp.country || "IT", address: cp.address || null, city: cp.city || null, cap: cp.cap || null, province: cp.province || null, sdi_code: f.sdi_code || null, pec: f.pec || null });
    setMsg(error ? "Errore anagrafica: " + friendlyError(error) : "Intestatario salvato in anagrafica ✓");
    if (!error) loadCounterparts();
  };
  // Se in alto è selezionata UNA struttura, il documento in bozza la eredita (menu nascosto),
  // ma solo se non è già collegato a una prenotazione (in tal caso vale la struttura della prenotazione).
  useEffect(() => {
    if (doc?.stato === "bozza" && !link.bookingId && activeStructureId !== "all" && structures.some((x) => x.id === activeStructureId)) {
      setStructureId((cur) => (cur === activeStructureId ? cur : activeStructureId));
    }
  }, [doc?.stato, activeStructureId, structures, link.bookingId]);

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

  const preBollo = totals.taxable + totals.vat + totals.out;
  const bolloEligible = doc?.regime === "forfettario" && preBollo > BOLLO_THRESHOLD_CENTS;

  // Bollo automatico (impostazione "Bollo automatico", forfettario): segue la soglia finché l'utente non lo tocca a mano.
  const bolloAutoOn = doc?.regime === "forfettario" && (issuer?.bollo_auto ?? true);
  useEffect(() => {
    if (doc?.stato !== "bozza" || !bolloAutoOn || bolloTouched.current) return;
    setF((p) => (p.bollo === bolloEligible ? p : { ...p, bollo: bolloEligible }));
  }, [doc?.stato, bolloAutoOn, bolloEligible]);

  const paid = pays.reduce((a, p) => a + p.amount_cents, 0);
  // Note di credito emesse collegate a questo documento: riducono quanto resta da incassare.
  const credited = related.filter((r) => r.role === "Nota di credito" && r.stato && CREDIT_VALID.has(r.stato)).reduce((a, r) => a + (r.total_cents ?? 0), 0);
  const residuo = totals.total - paid - credited;
  const frozen = !!doc && doc.stato !== "bozza";
  const isCreditNote = (doc?.doc_kind ?? f.doc_kind) === "nota_di_credito";

  // Controlli prima dell'emissione (solo in bozza). Errori = bloccano "Emetti"; avvisi = solo segnalati.
  const issues: Issue[] = useMemo(() => {
    if (!doc || doc.stato !== "bozza") return [];
    return validateDocument({
      docKind: f.doc_kind, regime: doc.regime, issueDate: f.issue_date, dueDate: f.due_date, sendSdi: f.send_sdi,
      counterpart: { kind: cp.kind, name: cp.name, lastName: cp.lastName, vat: cp.vat, tax_code: cp.tax_code, country: cp.country, address: cp.address, city: cp.city, cap: cp.cap, province: cp.province },
      sdiCode: f.sdi_code, pec: f.pec,
      lines: lines.map((l) => ({ description: l.description, qty: l.qty, unitEur: l.unitEur, vat: l.vat })),
      bollo: f.bollo, preBolloCents: preBollo, totalCents: totals.total, bolloThresholdCents: BOLLO_THRESHOLD_CENTS, issuer,
    });
  }, [doc, f, cp, lines, preBollo, totals.total, issuer]);
  const blocked = hasErrors(issues);

  const setLine = (i: number, patch: Partial<ELine>) => setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = (preset: Partial<ELine>) => setLines((p) => [...p, { description: "", qty: 1, unitEur: 0, vat: defaultVat(doc?.regime, "22"), sourceKind: "extra", ...preset }]);
  const delLine = (i: number) => setLines((p) => p.filter((_, j) => j !== i));
  const delCityTax = () => setLines((p) => p.filter((l) => l.vat !== "N1" && l.sourceKind !== "city_tax"));

  const dmy = (iso: string) => fmtDate(iso);
  const attachBooking = (bid: string) => {
    const b = bookings.find((x) => x.id === bid); if (!b) return;
    const rt = getRoomType(b.roomTypeId); const structure = getStructure(b.structureId); const g = getGuest(b.guestId);
    const add: ELine[] = [];
    // Aliquote secondo il regime del documento (forfettario → N2.2, come fa il folio lato server).
    const v10 = defaultVat(doc?.regime, "10"), v22 = defaultVat(doc?.regime, "22");
    if (b.total) add.push({ description: `${(rt?.name ?? "Soggiorno").toUpperCase()} – ${dmy(b.checkIn)} al ${dmy(b.checkOut)}`, qty: 1, unitEur: b.total, vat: v10, sourceKind: "accommodation" });
    if (b.cleaningFee) add.push({ description: "Pulizia finale", qty: 1, unitEur: b.cleaningFee, vat: v10, sourceKind: "cleaning" });
    (b.extras ?? []).forEach((e) => { if (e?.price) add.push({ description: e.name || "Extra", qty: 1, unitEur: e.price, vat: v22, sourceKind: "extra" }); });
    const tax = cityTaxOfBooking(structure, b);
    if (tax) add.push({ description: "Imposta di soggiorno", qty: 1, unitEur: tax, vat: "N1", sourceKind: "city_tax" });
    setLines((p) => [...p, ...add]);
    setStructureId(b.structureId);
    setLink({ bookingId: b.id, bookingCode: b.code ?? null });
    const ir = b.invoiceRequest;
    const irHasData = !!(ir && (ir.name || ir.vat || ir.taxCode || ir.address || ir.sdiCode || ir.pec));
    if (ir && (ir.wants || irHasData)) {
      setCp({ kind: ir.kind ?? "privato", name: ir.name ?? "", lastName: "", vat: ir.vat ?? "", tax_code: ir.taxCode ?? "", country: ir.country ?? "IT", address: ir.address ?? "", city: ir.city ?? "", cap: ir.cap ?? "", province: ir.province ?? "" });
      setF((p) => ({ ...p, sdi_code: ir.sdiCode || p.sdi_code, pec: ir.pec ?? p.pec }));
    } else if (g) {
      // Nessuna richiesta di fattura: si parte dai dati lasciati dall'ospite al check-in (solo campi ancora vuoti).
      const street = [g.address, g.streetNumber].filter(Boolean).join(" ").trim();
      setCp((c) => ({ ...c, name: c.name || (g.firstName ?? g.fullName), lastName: c.lastName || (g.lastName ?? ""), address: c.address || street, province: c.province || (g.province ?? ""), country: c.country || g.country || "IT" }));
    }
    setBookingPicker(false);
  };
  const bookingList = useMemo(() => {
    const term = bq.trim().toLowerCase();
    // Solo prenotazioni della struttura del documento (o, se non ancora assegnata, di quella selezionata in alto).
    const scopeId = structureId || (activeStructureId !== "all" ? activeStructureId : "");
    return [...bookings].filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (!scopeId || b.structureId === scopeId))
      .sort((a, b) => (b.checkIn || "").localeCompare(a.checkIn || ""))
      .filter((b) => { if (!term) return true; return `${getGuest(b.guestId)?.fullName ?? ""} ${b.code ?? ""}`.toLowerCase().includes(term); })
      .slice(0, 40);
  }, [bookings, bq, getGuest, structureId, activeStructureId]);

  const saveDraft = async () => {
    if (!supabase || !user || !doc) return false;
    if (!tenantId) { setMsg("Account di lavoro non ancora caricato: riprova tra qualche secondo. Il documento non è stato modificato."); return false; }
    // Righe: elimino e reinserisco (solo in bozza è consentito dal trigger).
    // Si controlla ogni passaggio: se l'inserimento fallisce si ripristinano le righe di prima,
    // così il documento non resta mai senza righe a metà salvataggio.
    const { data: oldLines, error: selErr } = await supabase.from("document_lines").select("*").eq("document_id", id);
    if (selErr) { setMsg("Errore salvataggio righe: " + friendlyError(selErr) + " Il documento non è stato modificato."); return false; }
    const { error: delErr } = await supabase.from("document_lines").delete().eq("document_id", id);
    if (delErr) { setMsg("Errore salvataggio righe: " + friendlyError(delErr) + " Il documento non è stato modificato."); return false; }
    if (lines.length) {
      const { error: insErr } = await supabase.from("document_lines").insert(lines.map((l, i) => ({
        document_id: id, tenant_id: tenantId, pos: i + 1, description: l.description || "—", qty: l.qty || 1,
        unit_price_cents: Math.round(l.unitEur * 100), vat_rate: l.vat === "N1" || l.vat === "N2.2" ? 0 : Number(l.vat) || 0,
        vat_nature: l.vat === "N1" ? "N1" : l.vat === "N2.2" ? "N2.2" : null,
        line_total_cents: Math.round(l.unitEur * 100 * (l.qty || 0)), source_kind: l.sourceKind, booking_id: doc.booking_id, folio_ref: `l${i}`,
      })));
      if (insErr) {
        let restored = true;
        if (oldLines && oldLines.length) { const { error: rErr } = await supabase.from("document_lines").insert(oldLines); restored = !rErr; }
        setMsg(restored
          ? "Errore salvataggio righe: " + friendlyError(insErr) + " Le righe precedenti sono state ripristinate: riprova."
          : "ATTENZIONE: salvataggio righe non riuscito (" + friendlyError(insErr) + ") e le righe precedenti non si sono potute ripristinare. Non chiudere la pagina: ricaricala e controlla le righe del documento prima di continuare.");
        return false;
      }
    }
    const counterpart = { kind: cp.kind, name: cp.name, lastName: cp.lastName || undefined, vat: cp.vat || null, tax_code: cp.tax_code || null, country: cp.country || "IT", address: cp.address || null, city: cp.city || null, cap: cp.cap || null, province: cp.province || null, sdi_code: f.sdi_code || (cp.kind === "estero" ? "XXXXXXX" : "0000000"), pec: f.pec || null };
    const { error } = await supabase.from("documents").update({
      structure_id: structureId || null, serie: structureId || null, booking_id: link.bookingId, booking_code: link.bookingCode,
      doc_kind: f.doc_kind, sdi_type: f.doc_kind === "nota_di_credito" ? "TD04" : f.sdi_type, issue_date: f.issue_date || null, due_date: f.due_date || null,
      payment_terms: f.payment_terms, vat_exigibility: f.vat_exigibility, payment_method: f.payment_method, send_sdi: f.send_sdi, notes: f.notes || null,
      counterpart, taxable_cents: totals.taxable, vat_cents: totals.vat, out_of_scope_cents: totals.out, bollo_cents: totals.bolloCents,
      rounding_cents: totals.roundingCents, total_cents: totals.total,
    }).eq("id", id);
    if (error) { setMsg("Errore salvataggio: " + friendlyError(error)); return false; }
    return true;
  };

  const act = async (label: string, fn: () => Promise<void>) => { setBusy(label); setMsg(""); try { await fn(); await load(); } catch (e) { setMsg(friendlyError(e)); } finally { setBusy(""); } };
  const onSave = () => act("save", async () => { if (await saveDraft()) setMsg("Bozza salvata ✓"); });
  const blockMsg = () => setMsg("Non posso emettere: correggi prima gli errori elencati in “Controlli prima dell'emissione”.");
  const onIssue = () => { if (blocked) { blockMsg(); return; } act("issue", async () => { if (await saveDraft()) { await invPost("issue", { documentId: id }); setMsg("Documento emesso ✓"); } }); };
  const onSaveSend = () => { if (blocked) { blockMsg(); return; } act("savesend", async () => { if (await saveDraft()) { await invPost("issue", { documentId: id }); const r = await invPost<{ message?: string }>("send", { documentId: id }); setMsg(r.message || "Emesso e inviato"); } }); };
  // Invio di un documento emesso. Se era stato emesso con "Comunica al SDI" spento, il server lo accende e poi invia (enableSdi).
  // Prima di inviare si chiede conferma, dicendo se è modalità prova (non arriva allo SdI) o invio reale.
  const send = async () => {
    if (!doc) return;
    const action = sendAction(doc);
    if (!action) return;
    let dryRun: boolean | null = null;
    if (doc.provider === "fattureincloud") {
      try { const r = await invPost<{ dryRun?: boolean }>("provider", { provider: "fattureincloud", action: "status" }); dryRun = !!r.dryRun; } catch { dryRun = null; }
    }
    const t = sendConfirmText({ provider: doc.provider, dryRun, enableSdi: action === "enable_and_send", numberLabel: doc.number_label });
    if (!(await ask({ title: t.title, message: t.message, confirmLabel: t.confirmLabel }))) return;
    await act("send", async () => { const r = await invPost<{ message?: string }>("send", { documentId: id, ...(action === "enable_and_send" ? { enableSdi: true } : {}) }); if (r.message) setMsg(r.message); });
  };
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
    } catch (e) { setVies({ status: "unknown", msg: friendlyError(e) }); }
  };
  // Dopo l'incasso in Xenora, segna il pagamento anche sul documento di Fatture in Cloud (in background: non blocca né fa fallire l'incasso).
  const syncFicPayment = (paidFlag: boolean) => {
    if (!doc?.provider_ref?.startsWith("fic:")) return;
    setFicNote(null);
    invPost<{ ok?: boolean; skipped?: boolean; kind?: string; message?: string }>("fic/payments", { documentId: id, paid: paidFlag })
      .then((r) => { if (r.skipped && r.ok) return; setFicNote({ ok: !!r.ok, text: r.ok ? (r.message ?? "") : "Incasso registrato; su Fatture in Cloud non aggiornato: " + (r.message ?? "motivo sconosciuto") }); })
      .catch((e) => setFicNote({ ok: false, text: "Incasso registrato; su Fatture in Cloud non aggiornato: " + friendlyError(e) }));
  };
  const addPayment = async (amountCents: number, method: string) => {
    if (!supabase || !user || amountCents <= 0) return;
    if (!tenantId) { setMsg("Account di lavoro non ancora caricato: riprova tra qualche secondo."); return; }
    await act("pay", async () => {
      const { error: payErr } = await supabase!.from("document_payments").insert({ document_id: id, tenant_id: tenantId, amount_cents: amountCents, method });
      // Se il pagamento non è stato registrato NON si tocca booking.paid (altrimenti incassi e documento divergono).
      if (payErr) throw new Error("Pagamento non registrato: " + friendlyError(payErr));
      // Fonte di verità = prenotazione: propaga l'incasso su booking.paid (in €).
      if (link.bookingId) { const b = raw.bookings.find((x) => x.id === link.bookingId); if (b) { const due = Math.round(amountCents) / 100; const add = (b.total ?? 0) > 0 ? Math.min(due, balanceDue(b, getStructure(b.structureId))) : due; if (add > 0) updateBooking(b.id, { paid: roundCents((b.paid ?? 0) + add) }); } } // al massimo il residuo vero: niente raddoppio se booking.paid include gia' quei soldi
      syncFicPayment(true);
    });
  };
  const deleteDraft = async () => {
    if (!supabase || !doc || doc.stato !== "bozza") return;
    if (!(await ask({ title: "Elimina bozza", message: "Eliminare questa bozza di documento?", danger: true, confirmLabel: "Elimina" }))) return;
    setBusy("del"); setMsg("");
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) { setMsg("Errore: " + friendlyError(error)); setBusy(""); return; }
    router.push("/documenti");
  };

  // Anteprima (autoPrint=false) o stampa/PDF (autoPrint=true) dello stesso documento di cortesia.
  const openDoc = async (autoPrint: boolean) => {
    if (!doc || !supabase || !tenantId) return;
    const { data: se } = await supabase.from("tenant_invoice_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
    // Riepilogo IVA per aliquota/natura (stessa matematica dei totali a video).
    const vatGroups = (() => {
      const g = new Map<string, { label: string; base: number; vat: number }>();
      for (const l of lines) {
        const cents = Math.round(l.unitEur * 100 * (l.qty || 0));
        const label = l.vat === "N1" ? "Fuori campo IVA (N1)" : l.vat === "N2.2" ? "Non soggetta (N2.2)" : `IVA ${l.vat}%`;
        const cur = g.get(l.vat) ?? { label, base: 0, vat: 0 };
        cur.base += cents; g.set(l.vat, cur);
      }
      for (const [k, v] of g) { const r = k === "N1" || k === "N2.2" ? 0 : Number(k) || 0; v.vat = Math.round(v.base * r / 100); }
      return [...g.values()];
    })();
    const origin = related.find((r) => r.role === "Documento di origine");
    const dmyLong = (iso: string) => (iso ? fmtDate(iso) : "");
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
      table{width:100%;border-collapse:collapse;margin-top:10px}th,td{padding:8px 6px;border-bottom:1px solid #e3e6ef}th{text-align:left;font-size:11px;text-transform:uppercase;color:#5c6479}td[style*="right"],.tot div span:last-child{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
      .tot{margin:14px 0 0;margin-left:auto;width:280px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .g{border-top:2px solid #285f92;font-weight:700;font-size:15px;margin-top:6px;padding-top:8px}
      .note{margin-top:26px;font-size:11px;color:#7a8194;border-top:1px solid #e3e6ef;padding-top:12px}@media print{body{padding:24px 30px}}</style></head><body>
      <div class="head"><div>${emit || '<div>Emittente da configurare</div>'}</div><div style="text-align:right"><div class="doc">${DOC_KIND_LABEL[doc.doc_kind]}</div><div>n. ${doc.number_label ?? "(bozza)"}</div><div>${f.issue_date ? fmtDate(f.issue_date) : ""}</div></div></div>
      <div class="p"><div><h4>Cliente</h4>${cli}</div>${doc.booking_code ? `<div style="text-align:right"><h4>Prenotazione</h4><div>${esc(doc.booking_code)}</div></div>` : ""}</div>
      <table><thead><tr><th>Descrizione</th><th style="text-align:right">Q.tà</th><th style="text-align:right">IVA</th><th style="text-align:right">Totale</th></tr></thead><tbody>${rows}</tbody></table>
      ${origin ? `<div class="note" style="border-top:0;margin-top:10px;padding-top:0">Storna il documento n. ${esc(origin.number_label ?? "")}</div>` : ""}
      <div class="tot"><div><span>Imponibile</span><span>${e(totals.taxable)}</span></div><div><span>IVA</span><span>${e(totals.vat)}</span></div>${totals.out ? `<div><span>Fuori campo IVA (art.15)</span><span>${e(totals.out)}</span></div>` : ""}${totals.bolloCents ? `<div><span>Bollo</span><span>${e(totals.bolloCents)}</span></div>` : ""}${totals.roundingCents ? `<div><span>Arrotondamento</span><span>${e(totals.roundingCents)}</span></div>` : ""}<div class="g"><span>Totale</span><span>${e(totals.total)}</span></div></div>
      ${vatGroups.length > 1 || (vatGroups[0] && vatGroups[0].vat > 0) ? `<table style="width:280px;margin-left:auto;font-size:11px;color:#5c6479"><thead><tr><th>Riepilogo IVA</th><th style="text-align:right">Imponibile</th><th style="text-align:right">Imposta</th></tr></thead><tbody>${vatGroups.map((g) => `<tr><td>${esc(g.label)}</td><td style="text-align:right">${e(g.base)}</td><td style="text-align:right">${e(g.vat)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${f.payment_method || f.due_date ? `<div class="note" style="border-top:0;margin-top:14px;padding-top:0">Pagamento: ${esc(f.payment_method)}${f.due_date ? ` · scadenza ${dmyLong(f.due_date)}` : ""}</div>` : ""}
      ${f.notes ? `<div class="note"><h4 style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#5c6479">Causale / Note</h4>${esc(f.notes)}</div>` : ""}
      <div class="note">${se?.regime_note ? esc(se.regime_note) + "<br>" : ""}${esc(se?.footer_note ?? "")}<br>Documento di cortesia — non valido ai fini fiscali.</div></body></html>`);
    w.document.close(); w.focus(); if (autoPrint) setTimeout(() => w.print(), 300);
  };
  const printPdf = () => openDoc(true);
  const previewDoc = () => openDoc(false);

  if (loading) return <div className="p-6 text-sm text-faint">Caricamento…</div>;
  if (!doc) return <div className="p-6 text-sm text-faint">Documento non trovato. <button onClick={() => router.push("/documenti")} className="font-semibold text-focus hover:underline">Torna ai documenti</button></div>;

  const trial = isTrialSend(events);
  const stBase = STATO[doc.stato] ?? { label: doc.stato, color: "var(--dim)" };
  const st = sdiBadge(doc.stato, trial, stBase);
  const sendAct = sendAction(doc);
  const rejected = doc.stato === "scartata" ? rejectionReason(events) : "";
  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";
  const e2 = (c: number) => eur(centsEur(c));
  // Scadenza = data di emissione + N giorni (non "oggi + N": la fattura può avere una data diversa).
  const setDue = (days: number) => setF((p) => {
    const base = p.issue_date ? new Date(p.issue_date + "T12:00:00") : new Date();
    base.setDate(base.getDate() + days);
    const pad = (n: number) => String(n).padStart(2, "0");
    return { ...p, due_date: `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}` };
  });

  return (
    <div>
      <PageHeader title={`${DOC_KIND_LABEL[doc.doc_kind] ?? "Documento"} ${doc.number_label ?? "(bozza)"}`}
        subtitle={doc.booking_code ? `Prenotazione ${doc.booking_code}` : undefined}
        actions={<Button variant="secondary" size="sm" onClick={() => router.push("/documenti")}>← Documenti</Button>} />

      {frozen && <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-wash px-4 py-2.5 text-sm text-dim"><span aria-hidden>🔒</span><span>Documento emesso: i dati fiscali non si modificano più. Per correggerli si emette una <b className="text-txt">nota di credito</b>.</span></div>}
      {msg && <Card className="mb-4"><p className="text-sm text-dim">{msg}</p></Card>}

      {bookingPicker && (
        <Modal open onClose={() => setBookingPicker(false)} title="Collega una prenotazione" size="md" closeLabel="Chiudi">
            <input value={bq} onChange={(e) => setBq(e.target.value)} placeholder="Cerca ospite o codice…" className={inp} autoFocus />
            <div className="mt-2 flex-1 overflow-y-auto">
              {bookingList.map((b) => (
                <button key={b.id} onClick={() => attachBooking(b.id)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left hover:border-focus hover:bg-wash">
                  <div className="min-w-0"><div className="truncate text-sm font-medium text-txt">{getGuest(b.guestId)?.fullName || "Ospite"} <span className="text-faint">· {b.code}</span></div><div className="text-[11px] text-faint">{fmtDate(b.checkIn)}–{fmtDate(b.checkOut)}</div></div>
                  <span className="shrink-0 font-mono text-sm text-txt">{eur(b.total ?? 0)}</span>
                </button>
              ))}
              {bookingList.length === 0 && <p className="py-6 text-center text-sm text-faint">Nessuna prenotazione.</p>}
            </div>
            <p className="mt-2 text-[11px] text-faint">Collegando la prenotazione, le righe del folio (soggiorno, pulizia, extra, tassa) vengono aggiunte alle voci.</p>
          </Modal>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
        {/* FATTURA */}
        <Card>
          <SectionTitle>Documento</SectionTitle>
          {frozen ? (
            <div className="mt-2 space-y-1 text-sm text-dim">
              <div>Tipo: <b className="text-txt">{DOC_KIND_LABEL[doc.doc_kind]}</b> · {doc.sdi_type}</div>
              <div>Numero: <b className="text-txt">{doc.number_label}</b> · {doc.issue_date && fmtDate(doc.issue_date)}</div>
              <div>Pagamento: {doc.payment_method} · scad. {doc.due_date ? fmtDate(doc.due_date) : "—"}</div>
            </div>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {activeStructureId === "all"
                ? <label className={lbl}>Struttura<select value={structureId} onChange={(e) => setStructureId(e.target.value)} className={inp}><option value="">— scegli —</option>{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                : <div><span className={lbl}>Struttura</span><div className="mt-1 rounded-lg border border-line bg-wash px-3 py-2 text-sm text-txt">{structures.find((x) => x.id === structureId)?.name ?? "—"}</div></div>}
              <div><span className={lbl}>Prenotazione <span className="text-faint">(facoltativa)</span></span>
                <div className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-lg border border-line bg-wash px-3 py-2 text-sm text-txt">{link.bookingCode ?? "nessuna"}</span>
                  <Button variant="secondary" size="xs" type="button" onClick={() => { setBq(""); setBookingPicker(true); }} className="shrink-0">Collega</Button>
                  {link.bookingId && <button aria-label="Scollega la prenotazione" type="button" onClick={() => setLink({ bookingId: null, bookingCode: null })} className="shrink-0 text-faint hover:text-[color:var(--err)]">✕</button>}
                </div>
              </div>
              <label className={lbl}>Tipologia<select value={f.doc_kind} onChange={(e) => setF({ ...f, doc_kind: e.target.value })} className={inp}><option value="fattura">Fattura</option><option value="nota_di_credito">Nota di credito</option><option value="ricevuta_non_fiscale">Ricevuta</option></select></label>
              <label className={lbl}>Data emissione<DateField value={f.issue_date} onChange={(v) => setF({ ...f, issue_date: v })} className={inp} /></label>
              <div><span className={lbl}>Scadenza pagamento</span><div className="mt-1 flex gap-1"><DateField value={f.due_date} onChange={(v) => setF({ ...f, due_date: v })} className="w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt" />{[0, 15, 30, 60].map((d) => <button key={d} onClick={() => setDue(d)} className="shrink-0 rounded-lg bg-wash px-2 text-xs font-semibold text-dim hover:bg-line" title={d === 0 ? "Scadenza = data di emissione" : `Scadenza = emissione + ${d} giorni`}>{d === 0 ? "ora" : `+${d}`}</button>)}</div></div>
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
                <Button variant="secondary" size="xs" type="button" onClick={saveCounterpart}>Salva in anagrafica</Button>
              </div>
              <label className={`${lbl} sm:col-span-2`}>Tipologia persona<select value={cp.kind} onChange={(e) => setCp({ ...cp, kind: e.target.value })} className={inp}><option value="privato">Privato</option><option value="societa">Società</option><option value="estero">Estero</option><option value="ota">OTA</option></select></label>
              <label className={cp.kind === "privato" ? lbl : `${lbl} sm:col-span-2`}>{cp.kind === "societa" ? "Ragione sociale" : "Nome"}<input value={cp.name} onChange={(e) => setCp({ ...cp, name: e.target.value })} className={inp} /></label>
              {cp.kind === "privato" && <label className={lbl}>Cognome<input value={cp.lastName} onChange={(e) => setCp({ ...cp, lastName: e.target.value })} className={inp} /></label>}
              <label className={lbl}>Nazione<input value={cp.country} onChange={(e) => setCp({ ...cp, country: e.target.value })} className={inp} /></label>
              {cp.kind !== "privato" && <div><span className={lbl}>Partita IVA</span><div className="mt-1 flex gap-1"><input value={cp.vat} onChange={(e) => { setCp({ ...cp, vat: e.target.value }); setVies({}); }} className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /><Button variant="secondary" size="xs" type="button" onClick={verifyVies} className="shrink-0">VIES</Button></div>{vies.status && vies.status !== "loading" && <span className="mt-0.5 block text-[11px] font-semibold" style={{ color: vies.status === "valid" ? "var(--ok)" : vies.status === "invalid" ? "var(--err)" : "var(--dim)" }}>{vies.status === "valid" ? "✓ " : vies.status === "invalid" ? "✕ " : ""}{vies.msg}</span>}{vies.status === "loading" && <span className="mt-0.5 block text-[11px] text-faint">Verifica…</span>}</div>}
              {cp.kind === "privato" && <label className={lbl}>Codice fiscale<input value={cp.tax_code} onChange={(e) => setCp({ ...cp, tax_code: e.target.value })} className={inp} /></label>}
              <label className={`${lbl} sm:col-span-2`}>Indirizzo<input value={cp.address} onChange={(e) => setCp({ ...cp, address: e.target.value })} className={inp} /></label>
              <label className={lbl}>Città<input value={cp.city} onChange={(e) => setCp({ ...cp, city: e.target.value })} className={inp} /></label>
              <div className="grid grid-cols-2 gap-2"><label className={lbl}>CAP<input value={cp.cap} onChange={(e) => setCp({ ...cp, cap: e.target.value })} className={inp} /></label><label className={lbl}>Prov.<input value={cp.province} onChange={(e) => setCp({ ...cp, province: e.target.value })} className={inp} /></label></div>
              <div className="sm:col-span-2 mt-1 border-t border-line pt-2">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">Fattura elettronica</div>
                <label className="flex items-center justify-between"><span className="text-sm text-txt">Comunica documento al SDI</span><input type="checkbox" checked={f.send_sdi} onChange={(e) => setF({ ...f, send_sdi: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>
                <div className="mt-2 grid grid-cols-2 gap-2"><label className={lbl}>Codice destinatario<input value={f.sdi_code} onChange={(e) => setF({ ...f, sdi_code: e.target.value })} className={inp} /></label><label className={lbl}>PEC<input value={f.pec} onChange={(e) => setF({ ...f, pec: e.target.value })} className={inp} /></label></div>
              </div>
            </div>
          )}
        </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
        {/* VOCI */}
        <Card>
          <SectionTitle>Voci del documento</SectionTitle>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-dim"><th className="py-1.5 pr-2 font-semibold">Descrizione</th><th className="py-1.5 px-1 text-right font-semibold">Q.tà</th><th className="py-1.5 px-1 text-right font-semibold">Prezzo</th><th className="py-1.5 px-1 font-semibold">IVA</th><th className="py-1.5 pl-1 text-right font-semibold">Totale</th>{!frozen && <th></th>}</tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {frozen ? <td className="py-2 pr-2 text-txt">{l.description}</td> : <td className="py-1 pr-2"><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className="w-full rounded border border-line bg-paper px-2 py-1 text-sm" /></td>}
                    {frozen ? <td className="py-2 px-1 text-right font-mono text-dim">{l.qty}</td> : <td className="py-1 px-1"><NumInput value={l.qty} decimals={3} onChange={(v) => setLine(i, { qty: v ?? 0 })} className="w-14 rounded border border-line bg-paper px-1 py-1 text-right text-sm" aria-label="Quantità" /></td>}
                    {frozen ? <td className="py-2 px-1 text-right font-mono text-dim">{eur(l.unitEur)}</td> : <td className="py-1 px-1"><NumInput value={l.unitEur} min={-1000000} onChange={(v) => setLine(i, { unitEur: v ?? 0 })} className="w-20 rounded border border-line bg-paper px-1 py-1 text-right text-sm" aria-label="Prezzo unitario" /></td>}
                    {frozen ? <td className="py-2 px-1 text-dim">{l.vat === "N1" || l.vat === "N2.2" ? l.vat : l.vat + "%"}</td> : <td className="py-1 px-1"><select value={l.vat} onChange={(e) => setLine(i, { vat: e.target.value })} className="rounded border border-line bg-paper px-1 py-1 text-sm">{VAT_OPTS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></td>}
                    <td className="py-1 pl-1 text-right font-mono text-txt">{eur(l.unitEur * (l.qty || 0))}</td>
                    {!frozen && <td className="py-1 pl-1 text-right"><button aria-label="Rimuovi la riga" onClick={() => delLine(i)} className="text-faint hover:text-[color:var(--err)]">✕</button></td>}
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-sm text-faint">Nessuna voce.</td></tr>}
              </tbody>
            </table>
          </div>
          {!frozen && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button variant="secondary" size="xs" onClick={() => addLine({ description: "", sourceKind: "extra" })}>+ Riga</Button>
              <Button variant="secondary" size="xs" onClick={() => addLine({ description: "Imposta di soggiorno", vat: "N1", sourceKind: "city_tax" })}>+ Tassa soggiorno</Button>
              <button onClick={delCityTax} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-[color:var(--err)] hover:bg-wash">Elimina tasse soggiorno</button>
            </div>
          )}
          <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between"><span className="text-dim">Imponibile</span><span className="font-mono">{e2(totals.taxable)}</span></div>
            <div className="flex justify-between"><span className="text-dim">IVA</span><span className="font-mono">{e2(totals.vat)}</span></div>
            {totals.out > 0 && <div className="flex justify-between"><span className="text-dim">Fuori campo IVA (art.15)</span><span className="font-mono">{e2(totals.out)}</span></div>}
            {!frozen && (
              <div className="flex items-center"><span className="flex-1 text-dim">Bollo virtuale {bolloEligible ? "(dovuto)" : ""}</span><input type="checkbox" checked={f.bollo} onChange={(e) => { bolloTouched.current = true; setF({ ...f, bollo: e.target.checked }); }} className="h-4 w-4 cursor-pointer accent-[color:var(--focus)]" /><span className="w-24 text-right font-mono">{e2(totals.bolloCents)}</span></div>
            )}
            {frozen && totals.bolloCents > 0 && <div className="flex justify-between"><span className="text-dim">Bollo</span><span className="font-mono">{e2(totals.bolloCents)}</span></div>}
            {!frozen && <div className="flex items-center"><span className="flex-1 text-dim">Arrotonda all'euro</span><input type="checkbox" checked={f.rounding} onChange={(e) => setF({ ...f, rounding: e.target.checked })} className="h-4 w-4 cursor-pointer accent-[color:var(--focus)]" /><span className="w-24 text-right font-mono">{e2(totals.roundingCents)}</span></div>}
            <div className="flex justify-between border-t border-line pt-1 text-base font-bold"><span>Totale</span><span className="font-mono">{e2(totals.total)}</span></div>
          </div>
        </Card>

        {/* STATO + INCASSI */}
        <Card>
          <div className="mb-2 flex items-center justify-between"><SectionTitle>Stato e incassi</SectionTitle><span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</span></div>
          <div className="flex flex-col gap-1.5">
            {events.map((ev) => <div key={ev.id} className="flex gap-2 text-[13px]"><span className="w-28 shrink-0 text-[11px] text-faint">{fmtDateTime(ev.ts)}</span>{(() => { const d = eventDisplay(ev.message); return <span className="text-txt">{d.text}{d.warn && <span className="mt-0.5 block text-[12px] font-medium text-[color:var(--warn)]">{d.warn}</span>}</span>; })()}</div>)}
          </div>
          {doc.stato === "inviata_intermediario" && (trial
            ? <p className="mt-2 rounded-lg px-3 py-2 text-[12px] font-medium text-dim" style={{ backgroundColor: "color-mix(in srgb, var(--dim) 12%, transparent)" }}>{TRIAL_NOTE} Verificala su Fatture in Cloud: l&apos;esito dello SdI non arriverà finché non viene inviata davvero.</p>
            : <p className="mt-2 text-[12px] text-dim">Trasmessa allo SdI: in attesa dell&apos;esito. Usa “Aggiorna esito” per controllare se è stata consegnata o scartata.</p>)}
          {doc.stato === "scartata" && <p className="mt-2 rounded-lg px-3 py-2 text-[12px] font-medium text-[color:var(--err)]" style={{ backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)" }}>Scartata dallo SdI{rejected ? ": " + rejected : "."} Correggi i dati e riemetti il documento (con nota di credito se serve).</p>}
          {sendAct === "enable_and_send" && <p className="mt-2 text-[12px] text-dim">Emesso senza comunicazione allo SdI: non è ancora stato inviato. Puoi inviarlo con il pulsante in basso.</p>}
          <div className="mt-3 border-t border-line pt-2">
            {isCreditNote ? (
              <p className="text-[12px] text-dim">La nota di credito riduce l&apos;importo dovuto dal documento di origine: non ha incassi propri.</p>
            ) : (<>
              <div className="mb-1 flex items-center justify-between"><span className="text-sm font-semibold text-txt">Incassi</span>{residuo > 0 ? <span className="text-[11px] font-semibold text-[color:var(--warn)]">Residuo {e2(residuo)}</span> : <span className="text-[11px] font-semibold text-[color:var(--ok)]">Saldato ✓</span>}</div>
              {pays.map((p) => <div key={p.id} className="flex justify-between text-sm text-dim"><span>{fmtDate(p.paid_at)} · {p.method}</span><span className="font-mono">{e2(p.amount_cents)}</span></div>)}
              {credited > 0 && <div className="flex justify-between text-sm text-dim"><span>Stornato da note di credito</span><span className="font-mono">−{e2(credited)}</span></div>}
              {residuo < 0 && <p className="mt-1 text-[11px] font-semibold text-[color:var(--warn)]">Incassato/stornato oltre il totale di {e2(-residuo)}: verifica gli incassi.</p>}
              {ficNote && <p className="mt-1 text-[11px] font-medium" style={{ color: ficNote.ok ? "var(--ok)" : "var(--dim)" }}>{ficNote.text}</p>}
              {residuo > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <input value={payAmt} onChange={(e) => setPayAmt(e.target.value)} inputMode="decimal" placeholder={`€ (max ${e2(residuo)})`} className="w-28 rounded border border-line bg-paper px-2 py-1.5 text-sm" />
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="rounded border border-line bg-paper px-1.5 py-1.5 text-sm"><option>Bonifico bancario</option><option>Carta</option><option>Contanti</option><option>PayPal</option><option>Assegno</option></select>
                  <Button variant="secondary" size="xs" onClick={() => { const pn = parseDecimalIT(payAmt); if (pn === null) { setMsg("Importo non valido: scrivi un numero, per esempio 1234,56."); return; } const c = Math.round(pn * 100); if (c <= 0) { setMsg("Indica un importo da incassare."); return; } if (c > residuo) { setMsg(`L'importo supera il residuo (${e2(residuo)}).`); return; } setPayAmt(""); addPayment(c, payMethod); }} disabled={!!busy || !payAmt.trim()}>Registra incasso</Button>
                  <Button size="xs" onClick={() => addPayment(residuo, payMethod)} disabled={!!busy}>Incassa tutto ({e2(residuo)})</Button>
                </div>
              )}
            </>)}
          </div>
          {related.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">Documenti collegati</div>
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
      </div>

      {/* CONTROLLI PRIMA DELL'EMISSIONE */}
      {!frozen && (
        <Card className="mt-4">
          <div className="flex items-center justify-between"><SectionTitle>Controlli prima dell&apos;emissione</SectionTitle>
            <span className="text-[11px] font-semibold" style={{ color: blocked ? "var(--err)" : issues.length ? "var(--warn)" : "var(--ok)" }}>{blocked ? `${issues.filter((i) => i.level === "error").length} da correggere` : issues.length ? `${issues.length} avvisi` : "tutto a posto ✓"}</span></div>
          {issues.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {issues.map((i, k) => <li key={k} className="flex gap-2 text-[13px]"><span className="shrink-0 font-bold" style={{ color: i.level === "error" ? "var(--err)" : "var(--warn)" }}>{i.level === "error" ? "✕" : "!"}</span><span className="text-txt">{i.msg}</span></li>)}
            </ul>
          ) : <p className="mt-1 text-[12px] text-dim">Dati dell&apos;emittente, intestatario, voci, date e bollo risultano coerenti.</p>}
          {blocked && <p className="mt-2 text-[11px] text-faint">Gli errori bloccano l&apos;emissione (puoi comunque salvare la bozza); gli avvisi no.</p>}
        </Card>
      )}

      {/* AZIONI */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        {!frozen && <>
          <Button variant="secondary" size="sm" onClick={onSave} disabled={!!busy}>{busy === "save" ? "Salvataggio…" : "Salva bozza"}</Button>
          <Button size="sm" onClick={onIssue} disabled={!!busy || blocked} title={blocked ? "Correggi prima gli errori nei controlli" : undefined}>{busy === "issue" ? "Emissione…" : "Emetti"}</Button>
          {f.send_sdi && f.doc_kind !== "ricevuta_non_fiscale" && <Button size="sm" onClick={onSaveSend} disabled={!!busy || blocked} title={blocked ? "Correggi prima gli errori nei controlli" : undefined}>{busy === "savesend" ? "…" : "Salva e invia"}</Button>}
          <button onClick={deleteDraft} disabled={!!busy} className="rounded-lg border border-[color:var(--err)] px-3 py-2 text-sm font-semibold text-[color:var(--err)] hover:bg-[color:color-mix(in_srgb,var(--err)_10%,transparent)] disabled:opacity-50">{busy === "del" ? "Elimino…" : "Elimina bozza"}</button>
        </>}
        {sendAct && <Button size="sm" onClick={send} disabled={!!busy}>{busy === "send" ? "Invio…" : sendButtonLabel(doc.provider)}</Button>}
        {doc.stato === "inviata_intermediario" && <Button variant="secondary" size="sm" onClick={refresh} disabled={!!busy}>{busy === "status" ? "Controllo…" : "Aggiorna esito"}</Button>}
        <Button variant="secondary" size="sm" onClick={previewDoc}>Anteprima</Button>
        <Button variant="secondary" size="sm" onClick={printPdf}>Stampa PDF</Button>
        {doc.provider_ref && <Button variant="secondary" size="sm" onClick={downloadXml} disabled={!!busy}>{busy === "xml" ? "…" : "Scarica XML"}</Button>}
        {frozen && doc.doc_kind !== "nota_di_credito" && doc.stato !== "stornata" && <button onClick={creditNote} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-[color:var(--err)] hover:bg-wash disabled:opacity-50">{busy === "nc" ? "…" : "Nota di credito"}</button>}
        <span className="ml-auto text-[11px] text-faint">Regime: {doc.regime ?? "—"} · {doc.send_sdi ? "SDI attivo" : "no SDI"}</span>
      </div>
    </div>
  );
}
