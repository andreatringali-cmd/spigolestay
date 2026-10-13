// Fatture in Cloud — documenti RICEVUTI (fatture/spese dei fornitori) in SOLA LETTURA.
//
// Fatture in Cloud riceve le e-fatture dei fornitori dal cassetto fiscale (SdI): qui le
// leggiamo e le convertiamo nei campi di "Fatture passive" di Xenora. Non si scrive mai su FIC.
//
// Doc ufficiale (verificata): GET /c/{company_id}/received_documents
//   - type (obbligatorio): expense | passive_credit_note | passive_delivery_note | self_invoice
//   - fieldset, sort (prefisso "-" = decrescente), page, per_page, q (filtro), fields
//   - scope OAuth: received_documents:r (sola lettura) / :a (scrittura)
//   - risposta: { data: ReceivedDocument[], total, current_page, last_page, per_page, ... }
// NON verificato sulla doc ufficiale (solo da fonte terza): sintassi di q per le date
// (`date >= '2026-01-01' and date <= '2026-06-30'`) e sort=-date; per questo c'e' un fallback
// progressivo (vedi `QUERY_TIERS`) e il filtro per data viene RIAPPLICATO lato nostro.
//
// Riferimento di deduplica: nelle note della fattura passiva viene scritto "[fic:<id>]".

import { FIC_API_BASE } from "@/lib/invoicing/fic-oauth";

export interface FicCfg { accessToken: string; companyId: string }

/** Errore "permesso mancante": l'host deve RICOLLEGARE Fatture in Cloud per concedere received_documents:r. */
export class FicScopeError extends Error {
  status: number;
  constructor(status: number) {
    super("Fatture in Cloud non ha concesso il permesso di lettura delle fatture ricevute. Ricollega Fatture in Cloud per autorizzarlo (le credenziali restano le stesse, serve solo un nuovo consenso).");
    this.name = "FicScopeError";
    this.status = status;
  }
}

// ---- Tipi (parziali) della risposta FIC ---------------------------------------
export interface FicPayment { id?: number; amount?: number | string; due_date?: string | null; paid_date?: string | null; status?: string | null }
export interface FicReceivedDoc {
  id: number;
  type?: string;
  entity?: { id?: number; name?: string; first_name?: string; last_name?: string; vat_number?: string; tax_code?: string; country_iso?: string } | null;
  date?: string | null;       // chiave reale del JSON (nell'SDK Python si chiama var_date)
  var_date?: string | null;
  description?: string | null;
  category?: string | null;
  amount_net?: number | string | null;
  amount_vat?: number | string | null;
  amount_gross?: number | string | null;
  amount_withholding_tax?: number | string | null;
  invoice_number?: string | null;
  e_invoice?: boolean | null;
  next_due_date?: string | null;
  currency?: { id?: string } | null;
  payments_list?: FicPayment[] | null;
}

export interface FicListResult { docs: FicReceivedDoc[]; page: number; lastPage: number; total: number; tier: number }

// ---- Chiamata elenco -----------------------------------------------------------
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const enc = encodeURIComponent;

// Tentativi progressivi: se FIC rifiuta (400) q o sort (sintassi non verificata) si riprova con meno parametri.
const QUERY_TIERS: { q: boolean; sort: boolean }[] = [{ q: true, sort: true }, { q: false, sort: true }, { q: false, sort: false }];

export async function listFicReceivedDocuments(
  cfg: FicCfg,
  opts: { from: string; to: string; page?: number; type?: string; perPage?: number },
): Promise<FicListResult> {
  if (!ISO.test(opts.from) || !ISO.test(opts.to)) throw new Error("Periodo non valido (usa date AAAA-MM-GG).");
  const page = Math.max(1, opts.page ?? 1);
  let lastErr = "";
  for (let tier = 0; tier < QUERY_TIERS.length; tier++) {
    const t = QUERY_TIERS[tier];
    const params = [`type=${enc(opts.type ?? "expense")}`, `fieldset=detailed`, `page=${page}`, `per_page=${opts.perPage ?? 100}`];
    if (t.sort) params.push(`sort=${enc("-date")}`);
    if (t.q) params.push(`q=${enc(`date >= '${opts.from}' and date <= '${opts.to}'`)}`);
    const res = await fetch(`${FIC_API_BASE}/c/${enc(cfg.companyId)}/received_documents?${params.join("&")}`, {
      headers: { Authorization: `Bearer ${cfg.accessToken}`, Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) throw new FicScopeError(res.status);
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    if (res.status === 400 && tier < QUERY_TIERS.length - 1) { lastErr = describeErr(json); continue; }
    if (res.status === 429) throw new Error("Fatture in Cloud: troppe richieste, riprova tra qualche minuto.");
    if (!res.ok) throw new Error(`Fatture in Cloud ${res.status}: ${describeErr(json) || lastErr || "errore nella lettura dei documenti ricevuti"}`);
    const all = Array.isArray(json.data) ? (json.data as FicReceivedDoc[]) : [];
    // Il filtro per data si riapplica sempre qui (difesa se q fosse ignorato nel fallback).
    const docs = all.filter((d) => { const dt = docDate(d); return !dt || (dt >= opts.from && dt <= opts.to); });
    return { docs, page, lastPage: Number(json.last_page) || 1, total: Number(json.total) || all.length, tier };
  }
  throw new Error("Fatture in Cloud: richiesta non accettata");
}

function describeErr(json: Record<string, unknown>): string {
  const e = json.error as { message?: string; validation_result?: unknown } | string | undefined;
  if (typeof e === "string") return e;
  return e?.message || (typeof json.message === "string" ? json.message : "");
}

const docDate = (d: FicReceivedDoc): string => String(d.date ?? d.var_date ?? "").slice(0, 10);

/** Scorre le pagine (max `maxPages`) di un tipo di documento. Senza q/sort non si puo' fermare prima. */
export async function listAllFicReceived(
  cfg: FicCfg,
  opts: { from: string; to: string; type: string; maxPages?: number },
): Promise<FicReceivedDoc[]> {
  const out: FicReceivedDoc[] = [];
  const max = opts.maxPages ?? 10;
  for (let p = 1; p <= max; p++) {
    const r = await listFicReceivedDocuments(cfg, { ...opts, page: p });
    out.push(...r.docs);
    if (p >= r.lastPage) break;
  }
  return out;
}

// ---- Mappatura -> fattura passiva di Xenora ------------------------------------
export interface PassiveDraft {
  ficId: number;
  supplier_name: string;
  supplier_vat: string | null;
  supplier_country: string | null;
  doc_number: string | null;
  doc_date: string | null;
  doc_type: "fattura" | "nota_credito" | "spesa";
  taxable_cents: number;
  vat_cents: number;
  total_cents: number;
  due_date: string | null;
  paid: boolean;
  paid_at: string | null;
  notes: string;
}

const toCents = (v: unknown): number => { const n = Number(v); return isFinite(n) ? Math.round(Math.abs(n) * 100) : 0; };
const dateOrNull = (v: unknown): string | null => { const s = String(v ?? "").slice(0, 10); return ISO.test(s) ? s : null; };

export const ficRef = (id: number | string) => `[fic:${id}]`;
/** Id FIC gia' importati, letti dalle note di una fattura passiva. */
export function extractFicIds(notes: string | null | undefined): number[] {
  return Array.from((notes ?? "").matchAll(/\[fic:(\d+)\]/g), (m) => Number(m[1]));
}

export function mapFicReceivedToPassive(doc: FicReceivedDoc): PassiveDraft {
  const ent = doc.entity ?? {};
  const name = (ent.name || [ent.first_name, ent.last_name].filter(Boolean).join(" ") || "").trim();
  const taxable = toCents(doc.amount_net);
  const vat = toCents(doc.amount_vat);
  const pays = Array.isArray(doc.payments_list) ? doc.payments_list : [];
  const paid = pays.length > 0 && pays.every((p) => p.status === "paid");
  const paidDates = pays.map((p) => dateOrNull(p.paid_date)).filter((x): x is string => !!x).sort();
  const unpaidDue = pays.filter((p) => p.status !== "paid").map((p) => dateOrNull(p.due_date)).filter((x): x is string => !!x).sort();
  const anyDue = pays.map((p) => dateOrNull(p.due_date)).filter((x): x is string => !!x).sort();
  const due = unpaidDue[0] ?? dateOrNull(doc.next_due_date) ?? anyDue[0] ?? null;
  const isCredit = doc.type === "passive_credit_note";
  const hasNumber = !!(doc.invoice_number && String(doc.invoice_number).trim());
  const extra: string[] = [];
  if (doc.description && String(doc.description).trim()) extra.push(String(doc.description).trim());
  if (doc.e_invoice) extra.push("e-fattura da cassetto fiscale");
  if (toCents(doc.amount_withholding_tax) > 0) extra.push(`ritenuta ${(toCents(doc.amount_withholding_tax) / 100).toFixed(2)} €`);
  const cur = doc.currency?.id;
  if (cur && cur !== "EUR") extra.push(`valuta ${cur}`);
  return {
    ficId: doc.id,
    supplier_name: name,
    supplier_vat: ent.vat_number ? String(ent.vat_number) : null,
    supplier_country: ent.country_iso ? String(ent.country_iso) : null,
    doc_number: hasNumber ? String(doc.invoice_number).trim() : null,
    doc_date: dateOrNull(docDate(doc)),
    doc_type: isCredit ? "nota_credito" : hasNumber || doc.e_invoice ? "fattura" : "spesa",
    taxable_cents: taxable,
    vat_cents: vat,
    total_cents: taxable + vat,
    due_date: due,
    paid,
    paid_at: paid ? (paidDates[paidDates.length - 1] ?? null) : null,
    notes: [ficRef(doc.id), ...extra].join(" · "),
  };
}

// ---- Deduplica -----------------------------------------------------------------
export interface ExistingDoc { supplier_name: string | null; doc_number: string | null; doc_date: string | null; notes: string | null }
/** "imported" = stesso id FIC gia' importato; "possible" = stesso fornitore+numero+anno inseriti a mano; "new" altrimenti. */
export type DedupStatus = "imported" | "possible" | "new";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function dedupStatus(d: PassiveDraft, existing: ExistingDoc[]): DedupStatus {
  const ids = new Set<number>();
  for (const e of existing) for (const id of extractFicIds(e.notes)) ids.add(id);
  if (ids.has(d.ficId)) return "imported";
  if (d.doc_number && d.supplier_name) {
    const y = (d.doc_date ?? "").slice(0, 4);
    const hit = existing.some((e) => norm(e.supplier_name) === norm(d.supplier_name) && norm(e.doc_number) === norm(d.doc_number) && (e.doc_date ?? "").slice(0, 4) === y);
    if (hit) return "possible";
  }
  return "new";
}

export interface PreviewItem extends PassiveDraft { status: DedupStatus }

export function buildPreview(docs: FicReceivedDoc[], existing: ExistingDoc[]): PreviewItem[] {
  const seen = new Set<number>();
  const out: PreviewItem[] = [];
  for (const doc of docs) {
    if (seen.has(doc.id)) continue; // lo stesso documento non va elencato due volte
    seen.add(doc.id);
    const d = mapFicReceivedToPassive(doc);
    out.push({ ...d, status: dedupStatus(d, existing) });
  }
  return out.sort((a, b) => (b.doc_date ?? "").localeCompare(a.doc_date ?? ""));
}
