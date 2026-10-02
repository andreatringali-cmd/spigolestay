// Fatture passive — logica pura (nessun I/O, testabile): importi con segno, riepiloghi,
// scadenzario, mappatura verso la Cassa e rilevamento duplicati.
// Importi in centesimi, come sul DB (tabella purchase_documents).

export interface PDoc {
  id: string; structure_id: string | null; supplier_name: string | null; doc_number: string | null; doc_date: string | null;
  doc_type: string; category: string | null; taxable_cents: number; vat_cents: number; total_cents: number;
  due_date: string | null; paid: boolean; paid_at: string | null; payment_method: string | null;
}

// Una nota di credito riduce il costo: negli aggregati vale in negativo, comunque sia stata digitata.
export const signOf = (docType: string): 1 | -1 => (docType === "nota_credito" ? -1 : 1);
export const signedCents = (d: Pick<PDoc, "doc_type">, cents: number): number => signOf(d.doc_type) * Math.abs(cents || 0);

export interface GroupRow { key: string; count: number; taxable: number; vat: number; total: number; unpaid: number }

export function groupTotals(docs: PDoc[], by: "supplier" | "category" | "month"): GroupRow[] {
  const m = new Map<string, GroupRow>();
  for (const d of docs) {
    const key = by === "supplier" ? (d.supplier_name || "Senza fornitore").trim() : by === "category" ? (d.category || "Senza categoria") : ((d.doc_date ?? "").slice(0, 7) || "Senza data");
    const r = m.get(key) ?? { key, count: 0, taxable: 0, vat: 0, total: 0, unpaid: 0 };
    const tot = signedCents(d, d.total_cents);
    r.count++; r.taxable += signedCents(d, d.taxable_cents); r.vat += signedCents(d, d.vat_cents); r.total += tot;
    if (!d.paid && d.doc_type !== "nota_credito") r.unpaid += tot;
    m.set(key, r);
  }
  const rows = Array.from(m.values());
  return by === "month" ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => b.total - a.total);
}

export interface DueBucket { count: number; cents: number }
export interface DueSummary { overdue: DueBucket; week: DueBucket; later: DueBucket; noDate: DueBucket }

const addDaysISO = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Scadenzario dei documenti NON pagati (le note di credito non sono un debito da pagare).
export function dueSummary(docs: PDoc[], todayISO: string, weekDays = 7): DueSummary {
  const s: DueSummary = { overdue: { count: 0, cents: 0 }, week: { count: 0, cents: 0 }, later: { count: 0, cents: 0 }, noDate: { count: 0, cents: 0 } };
  const limit = addDaysISO(todayISO, weekDays);
  for (const d of docs) {
    if (d.paid || d.doc_type === "nota_credito") continue;
    const c = Math.abs(d.total_cents || 0);
    const b = !d.due_date ? s.noDate : d.due_date < todayISO ? s.overdue : d.due_date <= limit ? s.week : s.later;
    b.count++; b.cents += c;
  }
  return s;
}

export type DueFilter = "all" | "overdue" | "week";
export function matchesDue(d: PDoc, f: DueFilter, todayISO: string, weekDays = 7): boolean {
  if (f === "all") return true;
  if (d.paid || d.doc_type === "nota_credito" || !d.due_date) return false;
  if (f === "overdue") return d.due_date < todayISO;
  return d.due_date >= todayISO && d.due_date <= addDaysISO(todayISO, weekDays);
}

// ---- Collegamento alla Cassa (cash_movements) ----------------------------------------------
// Categorie e conti sono quelli della pagina Cassa.
const CASH_CAT: Record<string, string> = { "Pulizie": "pulizie", "Utenze": "utenze", "Manutenzione": "manutenzione", "Forniture": "forniture", "Tasse e tributi": "tasse", "Marketing": "marketing" };
// "OTA / commissioni" resta su "altro_out": le commissioni OTA sono già generate in automatico dalle prenotazioni.
export const cashCategoryOf = (category: string | null): string => (category && CASH_CAT[category]) || "altro_out";
export const cashContoOf = (method: string | null): string => {
  const m = (method || "").toLowerCase();
  if (m.includes("contant")) return "contanti";
  if (m.includes("paypal")) return "paypal";
  if (m.includes("carta")) return "carta";
  return "banca";
};

export interface CashRow { id: string; tenant_id: string; structure_id: string | null; date: string; kind: "in" | "out"; cat: string; descr: string; amount_cents: number; conto: string }
// L'id del movimento è l'id del documento: una fattura non può finire due volte in Cassa.
export function toCashRow(d: PDoc, tenantId: string, todayISO: string): CashRow | null {
  if (!d.paid) return null;
  const amount = Math.abs(d.total_cents || 0);
  if (amount <= 0) return null;
  const who = [d.supplier_name, d.doc_number].filter(Boolean).join(" · ");
  return {
    id: d.id, tenant_id: tenantId, structure_id: d.structure_id, date: d.paid_at || todayISO,
    kind: d.doc_type === "nota_credito" ? "in" : "out", cat: cashCategoryOf(d.category),
    descr: `${d.doc_type === "nota_credito" ? "Nota di credito" : "Fattura passiva"} ${who}`.trim(), amount_cents: amount, conto: cashContoOf(d.payment_method),
  };
}

// ---- Duplicati -----------------------------------------------------------------------------
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
// Stesso fornitore + stesso numero + stesso anno (esclude il documento stesso in modifica).
export function findDuplicate(docs: PDoc[], c: { id?: string; supplier_name: string; doc_number: string; doc_date: string }): PDoc | undefined {
  if (!norm(c.doc_number) || !norm(c.supplier_name)) return undefined;
  const y = (c.doc_date || "").slice(0, 4);
  return docs.find((d) => d.id !== c.id && norm(d.supplier_name) === norm(c.supplier_name) && norm(d.doc_number) === norm(c.doc_number) && (d.doc_date ?? "").slice(0, 4) === y);
}

// ---- CSV -----------------------------------------------------------------------------------
export const csvCell = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
