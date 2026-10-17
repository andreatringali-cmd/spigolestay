// Pacchetto per il commercialista — logica PURA (nessun I/O, nessun React), testabile.
// Aggrega, per un periodo (trimestre o anno) e una struttura, i dati che la pagina "Fascicolo fiscale"
// già carica: documenti fiscali (documents), pagamenti sui documenti (document_payments), fatture
// passive (purchase_documents) e prenotazioni (imposta di soggiorno).
// NIENTE regole fiscali nuove: bollo, residui e fatture passive riusano bollo.ts / receivables.ts /
// purchases.ts; l'imposta di soggiorno arriva da una funzione passata dal chiamante (cityTaxOfBooking).
// Importi in CENTESIMI (come sul DB), tranne la tassa di soggiorno che nelle prenotazioni è in euro.
import { bolloQuarters, type QuarterInfo } from "./invoicing/bollo";
import { computeResidui } from "./invoicing/receivables";
import { buildCsv, centsToCsv } from "./invoicing/csv";
import { signedCents, type PDoc } from "./purchases";
import { eur } from "./format";
import { plural } from "./plural";

// ---------------------------------------------------------------- periodo
/** q = 0 → anno intero; 1..4 → trimestre. */
export interface PackPeriod { year: number; q: 0 | 1 | 2 | 3 | 4 }
export interface PackRange { from: string; to: string; label: string; lastDay: string } // to ESCLUSO

export const periodKey = (p: PackPeriod): string => `${p.year}-${p.q === 0 ? "Y" : `Q${p.q}`}`;
export function parsePeriodKey(s: string): PackPeriod | null {
  const m = /^(\d{4})-(Y|Q([1-4]))$/.exec(s);
  if (!m) return null;
  return { year: Number(m[1]), q: (m[3] ? Number(m[3]) : 0) as PackPeriod["q"] };
}
/** Trimestre corrente (default del selettore). */
export function currentPeriod(now: Date = new Date()): PackPeriod {
  return { year: now.getFullYear(), q: (Math.floor(now.getMonth() / 3) + 1) as PackPeriod["q"] };
}
const p2 = (n: number) => String(n).padStart(2, "0");
const dayBefore = (iso: string): string => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
export function periodRange(p: PackPeriod): PackRange {
  if (p.q === 0) {
    const to = `${p.year + 1}-01-01`;
    return { from: `${p.year}-01-01`, to, label: `Anno ${p.year}`, lastDay: dayBefore(to) };
  }
  const startM = (p.q - 1) * 3;
  const to = startM + 3 >= 12 ? `${p.year + 1}-01-01` : `${p.year}-${p2(startM + 4)}-01`;
  return { from: `${p.year}-${p2(startM + 1)}-01`, to, label: `${p.q}º trimestre ${p.year}`, lastDay: dayBefore(to) };
}
export const inRange = (iso: string | null | undefined, r: PackRange): boolean => { const d = (iso ?? "").slice(0, 10); return d.length === 10 && d >= r.from && d < r.to; };
export const dmy = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "");
export const slug = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// "€ 1.234,50" come in tutta l'app (€ davanti, migliaia sempre separate); il meno è il segno tipografico "−".
export const fmtEurCents = (c: number): string => `${c < 0 && Math.round(c) !== 0 ? "−" : ""}${eur(Math.abs(c) / 100)}`;

// ---------------------------------------------------------------- documenti emessi
export interface PackDoc {
  id: string; structure_id: string | null; doc_kind: string; stato: string;
  issue_date: string | null; created_at: string | null; number_label: string | null;
  counterpart: { name?: string; lastName?: string; vat?: string | null; tax_code?: string | null; country?: string } | null;
  taxable_cents: number; vat_cents: number; out_of_scope_cents: number; bollo_cents: number; total_cents: number;
  regime?: string | null; send_sdi?: boolean | null; related_document_id?: string | null; due_date?: string | null;
}
const ISSUED = new Set(["emessa", "inviata_intermediario", "consegnata"]);
const STATO_LABEL: Record<string, string> = { bozza: "Bozza", emessa: "Emessa", inviata_intermediario: "Inviata allo SdI", consegnata: "Consegnata", scartata: "Scartata", stornata: "Stornata" };
/** Data del documento: emissione, altrimenti creazione (come fanno le pagine esistenti). */
export const docDate = (d: Pick<PackDoc, "issue_date" | "created_at">): string => (d.issue_date ?? d.created_at ?? "").slice(0, 10);
const inScope = (structure_id: string | null, structureId: string) => structureId === "all" || structure_id === structureId;
const cpName = (d: Pick<PackDoc, "counterpart">) => `${d.counterpart?.name ?? ""} ${d.counterpart?.lastName ?? ""}`.trim();

export interface InvoiceRow {
  id: string; date: string; number: string; tipo: "Fattura" | "Nota di credito"; customer: string; vat: string; taxCode: string;
  taxable: number; vatAmount: number; outOfScope: number; bollo: number; total: number; // già CON segno (NC negative)
  stato: string; statoLabel: string; trial: boolean; notSent: boolean; missingTaxCode: boolean; regime: string; hasIssueDate: boolean; docKind: string;
}
export interface InvoiceTotals { taxable: number; vat: number; outOfScope: number; bollo: number; total: number }
export interface InvoicePack {
  rows: InvoiceRow[]; totals: InvoiceTotals; nFatture: number; nNoteCredito: number;
  drafts: number; rejected: number; annulled: number; // esclusi dai totali
}

/** Fatture e note di credito EMESSE nel periodo. Esclusi: bozze, ricevute non fiscali, scartate, stornate (contate a parte). */
export function packInvoices(docs: PackDoc[], range: PackRange, structureId: string, trialIds: ReadonlySet<string> = new Set()): InvoicePack {
  const rows: InvoiceRow[] = [];
  let drafts = 0, rejected = 0, annulled = 0;
  for (const d of docs) {
    if (d.doc_kind === "ricevuta_non_fiscale" || !inScope(d.structure_id, structureId)) continue;
    const date = docDate(d);
    if (!inRange(date, range)) continue;
    if (d.stato === "bozza") { drafts++; continue; }
    if (d.stato === "scartata") { rejected++; continue; }
    if (d.stato === "stornata") { annulled++; continue; }
    if (!ISSUED.has(d.stato) || (d.doc_kind !== "fattura" && d.doc_kind !== "nota_di_credito")) continue;
    const nc = d.doc_kind === "nota_di_credito";
    const sg = nc ? -1 : 1;
    const trial = d.stato === "inviata_intermediario" && trialIds.has(d.id);
    const cp = d.counterpart;
    const italian = !cp?.country || cp.country.toUpperCase() === "IT";
    rows.push({
      id: d.id, date, number: d.number_label ?? "", tipo: nc ? "Nota di credito" : "Fattura", customer: cpName(d), vat: cp?.vat ?? "", taxCode: cp?.tax_code ?? "",
      taxable: sg * (d.taxable_cents ?? 0), vatAmount: sg * (d.vat_cents ?? 0), outOfScope: sg * (d.out_of_scope_cents ?? 0), bollo: sg * (d.bollo_cents ?? 0), total: sg * (d.total_cents ?? 0),
      stato: d.stato, trial, notSent: d.stato === "emessa" && d.send_sdi !== false,
      statoLabel: trial ? "In prova (non trasmessa allo SdI)" : d.stato === "emessa" && d.send_sdi !== false ? "Emessa (non ancora inviata allo SdI)" : (STATO_LABEL[d.stato] ?? d.stato),
      // Cliente italiano senza P.IVA e senza codice fiscale: dato oggettivo dal documento, non un giudizio fiscale.
      missingTaxCode: !nc && italian && !cp?.vat && !cp?.tax_code,
      regime: d.regime ?? "", hasIssueDate: !!d.issue_date, docKind: d.doc_kind,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, "it", { numeric: true }));
  const totals = rows.reduce<InvoiceTotals>((a, r) => ({ taxable: a.taxable + r.taxable, vat: a.vat + r.vatAmount, outOfScope: a.outOfScope + r.outOfScope, bollo: a.bollo + r.bollo, total: a.total + r.total }), { taxable: 0, vat: 0, outOfScope: 0, bollo: 0, total: 0 });
  return { rows, totals, nFatture: rows.filter((r) => r.docKind === "fattura").length, nNoteCredito: rows.filter((r) => r.docKind === "nota_di_credito").length, drafts, rejected, annulled };
}

// ---------------------------------------------------------------- bollo
export interface BolloPack {
  count: number; cents: number;        // documenti con bollo nel periodo e importo (con segno)
  quarters: QuarterInfo[];             // i trimestri del periodo, con scadenza F24 (da bollo.ts)
}
/** Bollo dei documenti emessi del periodo. Le scadenze F24 vengono da bollo.ts (riferimento indicativo: da confermare). */
export function packBollo(docs: PackDoc[], period: PackPeriod, structureId: string): BolloPack {
  const yearRange = periodRange({ year: period.year, q: 0 });
  const yearRows = docs
    .filter((d) => (d.doc_kind === "fattura" || d.doc_kind === "nota_di_credito") && ISSUED.has(d.stato) && inScope(d.structure_id, structureId) && inRange(docDate(d), yearRange))
    .map((d) => ({ issue_date: docDate(d), bollo_cents: (d.doc_kind === "nota_di_credito" ? -1 : 1) * (d.bollo_cents ?? 0), has: (d.bollo_cents ?? 0) !== 0 }))
    .filter((r) => r.has);
  const all = bolloQuarters(yearRows.map(({ issue_date, bollo_cents }) => ({ issue_date, bollo_cents })), period.year);
  const quarters = period.q === 0 ? all : all.filter((x) => x.q === period.q);
  return { count: quarters.reduce((a, x) => a + x.count, 0), cents: quarters.reduce((a, x) => a + x.cents, 0), quarters };
}

// ---------------------------------------------------------------- imposta di soggiorno
export interface PackBooking { checkIn: string; structureId: string; status: string; channel: string; cityTaxPaid?: boolean }
export interface CityTaxPack { enabled: boolean; count: number; dovuta: number; incassata: number; daIncassare: number } // in euro
/** Come la pagina Tassa di soggiorno: prenotazioni con ARRIVO nel periodo. taxOf → null se la struttura non ha la tassa attiva. */
export function packCityTax<B extends PackBooking>(bookings: B[], taxOf: (b: B) => number | null, range: PackRange, structureId: string): CityTaxPack {
  let enabled = false, count = 0, dovuta = 0, incassata = 0;
  for (const b of bookings) {
    if (b.status === "cancelled" || b.channel === "blocked" || !inScope(b.structureId, structureId) || !inRange(b.checkIn, range)) continue;
    const tax = taxOf(b);
    if (tax === null) continue;
    enabled = true;
    if (tax <= 0) continue;
    count++; dovuta += tax;
    if (b.cityTaxPaid) incassata += tax;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { enabled, count, dovuta: r2(dovuta), incassata: r2(incassata), daIncassare: Math.max(0, r2(dovuta - incassata)) };
}

// ---------------------------------------------------------------- incassi
export interface PackPayment { document_id: string; amount_cents: number; method: string | null; paid_at: string | null }
export interface MethodRow { method: string; count: number; cents: number }
export interface IncassiPack { rows: MethodRow[]; count: number; cents: number }
const methodLabel = (m: string | null): string => { const t = (m ?? "").trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Non indicato"; };
/** Pagamenti registrati sui documenti (document_payments) con data nel periodo, per metodo. */
export function packIncassi(payments: PackPayment[], docs: PackDoc[], range: PackRange, structureId: string): IncassiPack {
  const byId = new Map(docs.map((d) => [d.id, d] as const));
  const map = new Map<string, MethodRow>();
  for (const p of payments) {
    if (!inRange(p.paid_at, range)) continue;
    const d = byId.get(p.document_id);
    if (d ? (!inScope(d.structure_id, structureId) || d.stato === "bozza" || d.stato === "scartata") : structureId !== "all") continue;
    const label = methodLabel(p.method);
    const key = label.toLowerCase();
    const cur = map.get(key) ?? { method: label, count: 0, cents: 0 };
    cur.count++; cur.cents += p.amount_cents ?? 0;
    map.set(key, cur);
  }
  const rows = [...map.values()].sort((a, b) => b.cents - a.cents);
  return { rows, count: rows.reduce((a, r) => a + r.count, 0), cents: rows.reduce((a, r) => a + r.cents, 0) };
}

export interface UnpaidRow { id: string; date: string; number: string; customer: string; total: number; paid: number; credited: number; residuo: number; dueDate: string }
export interface UnpaidPack { rows: UnpaidRow[]; count: number; cents: number }
/** Fatture EMESSE nel periodo non ancora incassate del tutto (residuo = totale − incassi − note di credito collegate: receivables.ts). */
export function packUnpaid(docs: PackDoc[], payments: PackPayment[], range: PackRange, structureId: string): UnpaidPack {
  const paidById: Record<string, number> = {};
  for (const p of payments) paidById[p.document_id] = (paidById[p.document_id] ?? 0) + (p.amount_cents ?? 0);
  const residui = computeResidui(docs.map((d) => ({ id: d.id, doc_kind: d.doc_kind, stato: d.stato, total_cents: d.total_cents ?? 0, due_date: d.due_date ?? null, related_document_id: d.related_document_id ?? null })), paidById);
  const rows: UnpaidRow[] = [];
  for (const d of docs) {
    if (d.doc_kind !== "fattura" || !ISSUED.has(d.stato) || !inScope(d.structure_id, structureId) || !inRange(docDate(d), range)) continue;
    const x = residui[d.id];
    if (!x || x.residuo <= 0) continue;
    rows.push({ id: d.id, date: docDate(d), number: d.number_label ?? "", customer: cpName(d), total: d.total_cents ?? 0, paid: x.paid, credited: x.credited, residuo: x.residuo, dueDate: d.due_date ?? "" });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, "it", { numeric: true }));
  return { rows, count: rows.length, cents: rows.reduce((a, r) => a + r.residuo, 0) };
}

// ---------------------------------------------------------------- fatture passive
export type PackPurchase = Pick<PDoc, "id" | "structure_id" | "supplier_name" | "doc_number" | "doc_date" | "doc_type" | "category" | "taxable_cents" | "vat_cents" | "total_cents" | "due_date" | "paid" | "paid_at" | "payment_method">;
export interface PurchasesPack { rows: PackPurchase[]; count: number; taxable: number; vat: number; total: number; unpaidCount: number; unpaidCents: number }
/** Documenti passivi con data nel periodo; le note di credito riducono il costo (signedCents di purchases.ts). */
export function packPurchases(docs: PackPurchase[], range: PackRange, structureId: string): PurchasesPack {
  const rows = docs.filter((d) => inRange(d.doc_date, range) && inScope(d.structure_id, structureId)).sort((a, b) => (a.doc_date ?? "").localeCompare(b.doc_date ?? ""));
  let taxable = 0, vat = 0, total = 0, unpaidCount = 0, unpaidCents = 0;
  for (const d of rows) {
    taxable += signedCents(d, d.taxable_cents); vat += signedCents(d, d.vat_cents); total += signedCents(d, d.total_cents);
    if (!d.paid && d.doc_type !== "nota_credito") { unpaidCount++; unpaidCents += signedCents(d, d.total_cents); }
  }
  return { rows, count: rows.length, taxable, vat, total, unpaidCount, unpaidCents };
}

// ---------------------------------------------------------------- pacchetto completo
export interface PackInput {
  period: PackPeriod; structureId: string; structureLabel: string;
  docs: PackDoc[]; payments: PackPayment[]; trialIds?: ReadonlySet<string>; purchases: PackPurchase[];
  bookings: PackBooking[]; cityTaxOf: (b: PackBooking) => number | null;
}
export interface AccountantPack {
  period: PackPeriod; range: PackRange; structureLabel: string;
  invoices: InvoicePack; bollo: BolloPack; cityTax: CityTaxPack; incassi: IncassiPack; unpaid: UnpaidPack; purchases: PurchasesPack;
  regimi: string[]; checklist: string[];
}
export function buildAccountantPack(inp: PackInput): AccountantPack {
  const range = periodRange(inp.period);
  const invoices = packInvoices(inp.docs, range, inp.structureId, inp.trialIds);
  const bollo = packBollo(inp.docs, inp.period, inp.structureId);
  const cityTax = packCityTax(inp.bookings, inp.cityTaxOf, range, inp.structureId);
  const incassi = packIncassi(inp.payments, inp.docs, range, inp.structureId);
  const unpaid = packUnpaid(inp.docs, inp.payments, range, inp.structureId);
  const purchases = packPurchases(inp.purchases, range, inp.structureId);
  const regimi = [...new Set(invoices.rows.map((r) => r.regime).filter(Boolean))];
  const checklist = buildChecklist({ invoices, bollo, cityTax, unpaid, purchases, regimi });
  return { period: inp.period, range, structureLabel: inp.structureLabel, invoices, bollo, cityTax, incassi, unpaid, purchases, regimi, checklist };
}

/** Punti OGGETTIVI ricavati dai dati (conteggi e importi); nessun consiglio fiscale. */
export function buildChecklist(p: Pick<AccountantPack, "invoices" | "bollo" | "cityTax" | "unpaid" | "purchases" | "regimi">): string[] {
  const out: string[] = [];
  const rows = p.invoices.rows;
  const miss = rows.filter((r) => r.missingTaxCode).length;
  if (miss) out.push(`${plural(miss, "fattura a cliente italiano", "fatture a clienti italiani")} senza P.IVA né codice fiscale`);
  const trial = rows.filter((r) => r.trial).length;
  if (trial) out.push(`${plural(trial, "documento", "documenti")} in prova, non trasmess${trial === 1 ? "o" : "i"} allo SdI`);
  const notSent = rows.filter((r) => r.notSent).length;
  if (notSent) out.push(`${plural(notSent, "documento emesso", "documenti emessi")} non ancora inviat${notSent === 1 ? "o" : "i"} allo SdI`);
  if (p.invoices.rejected) out.push(`${plural(p.invoices.rejected, "documento scartato", "documenti scartati")} dallo SdI (esclus${p.invoices.rejected === 1 ? "o" : "i"} dai totali)`);
  if (p.invoices.annulled) out.push(`${plural(p.invoices.annulled, "documento stornato", "documenti stornati")} (esclus${p.invoices.annulled === 1 ? "o" : "i"} dai totali)`);
  if (p.invoices.drafts) out.push(`${plural(p.invoices.drafts, "bozza", "bozze")} nel periodo, non inclus${p.invoices.drafts === 1 ? "a" : "e"}`);
  const noDate = rows.filter((r) => !r.hasIssueDate).length;
  if (noDate) out.push(`${plural(noDate, "documento", "documenti")} senza data di emissione (si usa la data di creazione)`);
  const bolloRows = rows.filter((r) => r.docKind === "fattura" && r.bollo !== 0);
  if (bolloRows.length) out.push(`${plural(bolloRows.length, "fattura", "fatture")} con bollo calcolato, per ${fmtEurCents(bolloRows.reduce((a, r) => a + r.bollo, 0))}`);
  const oos = rows.filter((r) => r.docKind === "fattura" && r.outOfScope !== 0);
  if (oos.length) out.push(`${plural(oos.length, "fattura", "fatture")} con importo fuori campo IVA (imposta di soggiorno, art. 15), per ${fmtEurCents(oos.reduce((a, r) => a + r.outOfScope, 0))}`);
  if (p.unpaid.count) out.push(`${plural(p.unpaid.count, "fattura emessa", "fatture emesse")} nel periodo non ancora incassat${p.unpaid.count === 1 ? "a" : "e"}, residuo ${fmtEurCents(p.unpaid.cents)}`);
  if (p.cityTax.enabled && p.cityTax.daIncassare > 0) out.push(`Imposta di soggiorno non ancora incassata: ${fmtEurCents(Math.round(p.cityTax.daIncassare * 100))} su ${fmtEurCents(Math.round(p.cityTax.dovuta * 100))} dovuti`);
  if (p.purchases.unpaidCount) out.push(`${plural(p.purchases.unpaidCount, "fattura passiva", "fatture passive")} non ancora pagat${p.purchases.unpaidCount === 1 ? "a" : "e"}, ${fmtEurCents(p.purchases.unpaidCents)}`);
  if (p.regimi.length) out.push(`Regime indicato sui documenti emessi: ${p.regimi.map((r) => r.replace(/_/g, " ")).join(", ")}`);
  if (rows.length === 0) out.push("Nessuna fattura emessa nel periodo selezionato");
  return out;
}

// ---------------------------------------------------------------- testi fissi
/** Domande aperte da portare al commercialista: SOLO promemoria, nessuna risposta. */
export const OPEN_QUESTIONS: { title: string; items: string[] }[] = [
  { title: "Imposta di bollo", items: [
    "Il bollo va addebitato all'ospite come voce \"Rimborso imposta di bollo\" (art. 15) oppure resta a carico di chi emette la fattura?",
    "Come si versa il bollo (F24, scadenze trimestrali)? Le date mostrate in questo riepilogo sono indicative: sono corrette per la tua situazione?",
  ] },
  { title: "Fatture ai privati", items: [
    "Per le fatture a privati: il codice fiscale del cliente è obbligatorio? Come comportarsi se l'ospite non lo comunica?",
  ] },
  { title: "Prenotazioni da OTA (Booking, Expedia, Airbnb)", items: [
    "Come vanno trattate le prenotazioni da OTA: a chi si intesta la fattura (ospite, OTA) e per quale importo (lordo o netto della commissione)?",
    "Come si registrano le commissioni delle OTA e le fatture che le OTA emettono alla struttura?",
  ] },
];

/** Istruzioni per condividere l'accesso: nessun URL inventato, solo il percorso del menu. */
export const FIC_SHARE_STEPS = "In Fatture in Cloud apri il menu \"Commercialista\" e invita il tuo commercialista via email dall'account: riceverà un invito per accedere ai documenti. Il nome esatto della voce può variare con la versione dell'interfaccia: verificalo nel tuo account.";

// ---------------------------------------------------------------- CSV
export interface PackCsv { filename: string; csv: string }
const baseName = (pack: Pick<AccountantPack, "period" | "structureLabel">, what: string) =>
  `commercialista-${what}-${pack.period.year}${pack.period.q === 0 ? "" : `-T${pack.period.q}`}${pack.structureLabel ? `-${slug(pack.structureLabel)}` : ""}`;

/** Fatture emesse del periodo (note di credito in negativo), con riga dei totali in fondo. */
export function invoicesCsv(pack: AccountantPack): PackCsv {
  const head = ["Data", "Numero", "Tipo", "Cliente", "P.IVA", "Codice fiscale", "Imponibile", "IVA", "Fuori campo IVA", "Bollo", "Totale", "Stato"];
  const lines: (string | number)[][] = pack.invoices.rows.map((r) => [dmy(r.date), r.number, r.tipo, r.customer, r.vat, r.taxCode, centsToCsv(r.taxable), centsToCsv(r.vatAmount), centsToCsv(r.outOfScope), centsToCsv(r.bollo), centsToCsv(r.total), r.statoLabel]);
  const t = pack.invoices.totals;
  lines.push(["", "", "", "TOTALE", "", "", centsToCsv(t.taxable), centsToCsv(t.vat), centsToCsv(t.outOfScope), centsToCsv(t.bollo), centsToCsv(t.total), ""]);
  return { filename: baseName(pack, "fatture-emesse"), csv: buildCsv(head, lines) };
}

export function purchasesCsv(pack: AccountantPack): PackCsv {
  const head = ["Data", "Numero", "Fornitore", "Tipo", "Categoria", "Imponibile", "IVA", "Totale", "Scadenza", "Pagata", "Data pagamento", "Metodo"];
  const lines: (string | number)[][] = pack.purchases.rows.map((d) => [dmy(d.doc_date), d.doc_number ?? "", d.supplier_name ?? "", d.doc_type === "nota_credito" ? "Nota di credito" : d.doc_type, d.category ?? "",
    centsToCsv(signedCents(d, d.taxable_cents)), centsToCsv(signedCents(d, d.vat_cents)), centsToCsv(signedCents(d, d.total_cents)), dmy(d.due_date), d.paid ? "sì" : "no", dmy(d.paid_at), d.payment_method ?? ""]);
  lines.push(["", "", "TOTALE", "", "", centsToCsv(pack.purchases.taxable), centsToCsv(pack.purchases.vat), centsToCsv(pack.purchases.total), "", "", "", ""]);
  return { filename: baseName(pack, "fatture-passive"), csv: buildCsv(head, lines) };
}

/** Riepilogo del periodo in forma "Sezione;Voce;Valore": bollo, imposta di soggiorno, incassi, non incassate, passive, checklist e domande aperte. */
export function summaryCsv(pack: AccountantPack): PackCsv {
  const L: string[][] = [];
  const add = (s: string, v: string, val: string | number = "") => L.push([s, v, String(val)]);
  const t = pack.invoices.totals;
  add("Periodo", pack.range.label, `${dmy(pack.range.from)} - ${dmy(pack.range.lastDay)}`);
  add("Periodo", "Struttura", pack.structureLabel);
  add("Fatture emesse", "Fatture", pack.invoices.nFatture);
  add("Fatture emesse", "Note di credito", pack.invoices.nNoteCredito);
  add("Fatture emesse", "Imponibile", centsToCsv(t.taxable));
  add("Fatture emesse", "IVA", centsToCsv(t.vat));
  add("Fatture emesse", "Fuori campo IVA (imposta di soggiorno, art. 15)", centsToCsv(t.outOfScope));
  add("Fatture emesse", "Bollo", centsToCsv(t.bollo));
  add("Fatture emesse", "Totale", centsToCsv(t.total));
  add("Bollo", "Documenti con bollo", pack.bollo.count);
  add("Bollo", "Importo bollo", centsToCsv(pack.bollo.cents));
  for (const q of pack.bollo.quarters) add("Bollo", `${q.q}º trimestre: scadenza F24 indicativa (tributo ${q.tributo}, da confermare)`, `${dmy(q.dueDate)} - ${centsToCsv(q.cents)}`);
  if (pack.cityTax.enabled) {
    add("Imposta di soggiorno", "Dovuta (arrivi del periodo)", pack.cityTax.dovuta.toFixed(2).replace(".", ","));
    add("Imposta di soggiorno", "Incassata", pack.cityTax.incassata.toFixed(2).replace(".", ","));
    add("Imposta di soggiorno", "Da incassare", pack.cityTax.daIncassare.toFixed(2).replace(".", ","));
  } else add("Imposta di soggiorno", "Non configurata per la struttura");
  for (const r of pack.incassi.rows) add("Incassi del periodo (per metodo)", `${r.method} (${r.count})`, centsToCsv(r.cents));
  add("Incassi del periodo (per metodo)", "Totale", centsToCsv(pack.incassi.cents));
  add("Fatture non incassate", `Fatture con residuo (${pack.unpaid.count})`, centsToCsv(pack.unpaid.cents));
  add("Fatture passive", "Documenti", pack.purchases.count);
  add("Fatture passive", "Imponibile", centsToCsv(pack.purchases.taxable));
  add("Fatture passive", "IVA", centsToCsv(pack.purchases.vat));
  add("Fatture passive", "Totale", centsToCsv(pack.purchases.total));
  add("Fatture passive", `Non ancora pagate (${pack.purchases.unpaidCount})`, centsToCsv(pack.purchases.unpaidCents));
  for (const c of pack.checklist) add("Da chiedere/confermare", c);
  for (const g of OPEN_QUESTIONS) for (const q of g.items) add("Domande aperte", g.title, q);
  return { filename: baseName(pack, "riepilogo"), csv: buildCsv(["Sezione", "Voce", "Valore"], L) };
}
