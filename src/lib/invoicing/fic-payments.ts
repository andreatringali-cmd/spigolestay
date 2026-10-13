// Fatture in Cloud — stato di pagamento dei documenti emessi: segna come pagato (e, se serve, torna a "non pagato").
//
// Doc ufficiale verificata (SDK ufficiali + guida "Invoice creation"):
//   lettura:   GET /c/{company_id}/issued_documents/{document_id}?fieldset=detailed
//   modifica:  PUT /c/{company_id}/issued_documents/{document_id}   body { data: { payments_list: [...] } }
//   voce di payments_list (IssuedDocumentPaymentsListItem): id, due_date, amount, status, payment_account { id },
//     paid_date ("impostata solo se lo stato e' paid"), payment_terms, ei_raw.
//   status: not_paid | paid | reversed.  Con status "paid" il conto di pagamento (payment_account.id) va indicato
//   e deve esistere, altrimenti l'API risponde con errore. Elenco conti: GET /c/{company_id}/info/payment_accounts.
// NON verificato con un token reale: che il PUT con la sola payments_list lasci intatte le altre parti del documento
//   (la doc non lo garantisce: lo si controlla sulla risposta, vedi checkPutResponse) e il comportamento sui documenti
//   gia' trasmessi allo SdI. Nessuna voce di pagamento viene mai cancellata o creata: si cambia solo lo stato delle voci esistenti
//   (rinviando l'id), le voci "reversed" non si toccano.

import { FIC_API_BASE } from "@/lib/invoicing/fic-oauth";
import type { FicCfg } from "@/lib/invoicing/fic-received";

export interface FicPaymentItem {
  id?: number;
  amount?: number | string;
  due_date?: string | null;
  paid_date?: string | null;
  status?: string | null;
  payment_account?: { id?: number; name?: string } | null;
  [k: string]: unknown;
}

export interface PaymentPlanInput {
  paid: boolean;
  /** Incassato in Xenora (euro). Serve solo per paid:true. */
  amountEur?: number;
  /** Data incasso AAAA-MM-GG (solo paid:true). */
  paidDate: string;
  /** Id del conto di pagamento da usare dove manca (solo paid:true). */
  accountId?: number | null;
}

export type PaymentPlan =
  | { action: "update"; payments: FicPaymentItem[]; message: string }
  | { action: "noop"; message: string; reason: "already" | "nothing" }
  | { action: "partial"; message: string }
  | { action: "need_account"; payments: FicPaymentItem[]; message: string };

const TOL = 0.005;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const statusOf = (p: FicPaymentItem) => String(p.status ?? "not_paid");

/** Totale da pagare secondo FIC = somma delle voci non stornate. */
export function ficPaymentsTotal(list: FicPaymentItem[]): number {
  return Math.round(list.filter((p) => statusOf(p) !== "reversed").reduce((a, p) => a + num(p.amount), 0) * 100) / 100;
}

/** Decide cosa fare sulle voci di pagamento di FIC. Funzione pura: nessuna rete. */
export function planFicPayment(list: FicPaymentItem[], o: PaymentPlanInput): PaymentPlan {
  const live = list.filter((p) => statusOf(p) !== "reversed");
  if (live.length === 0) return { action: "noop", reason: "nothing", message: "Su Fatture in Cloud il documento non ha voci di pagamento da aggiornare." };
  const total = ficPaymentsTotal(list);

  if (!o.paid) {
    if (!live.some((p) => statusOf(p) === "paid")) return { action: "noop", reason: "already", message: "Su Fatture in Cloud il documento risulta già non pagato." };
    const payments = list.map((p) => {
      if (statusOf(p) !== "paid") return { ...p };
      const { paid_date: _d, payment_account: _a, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { ...rest, status: "not_paid" };
    });
    return { action: "update", payments, message: "Segnato come non pagato anche su Fatture in Cloud ✓" };
  }

  if (live.every((p) => statusOf(p) === "paid")) return { action: "noop", reason: "already", message: "Su Fatture in Cloud il documento risulta già pagato." };
  const amount = o.amountEur ?? 0;
  if (amount + TOL < total) {
    return { action: "partial", message: "incasso parziale non sincronizzato: su Fatture in Cloud il documento resta da pagare finché non è incassato per intero" };
  }
  const payments = list.map((p) => {
    if (statusOf(p) !== "not_paid") return { ...p };
    const acc = p.payment_account?.id ?? o.accountId ?? null;
    return { ...p, status: "paid", paid_date: o.paidDate, ...(acc ? { payment_account: { id: acc } } : {}) };
  });
  const missing = payments.some((p) => statusOf(p) === "paid" && !p.payment_account?.id);
  if (missing) return { action: "need_account", payments, message: "nessun conto di pagamento disponibile su Fatture in Cloud" };
  return { action: "update", payments, message: "Segnato come pagato anche su Fatture in Cloud ✓" };
}

// ---- Errori leggibili ---------------------------------------------------------

function apiDetail(json: unknown): string {
  const e = (json as { error?: { message?: string; validation_result?: unknown } } | null)?.error;
  if (!e) return "";
  const vr = e.validation_result;
  const extra = vr && typeof vr === "object" ? Object.values(vr as Record<string, unknown>).flat().map((x) => (typeof x === "string" ? x : (x as { message?: string })?.message ?? "")).filter(Boolean).slice(0, 2).join("; ") : "";
  return [e.message, extra].filter(Boolean).join(" — ");
}

export function ficHttpMessage(status: number, json?: unknown): string {
  const d = apiDetail(json);
  const base =
    status === 401 ? "accesso non autorizzato: ricollega Fatture in Cloud da Impostazioni fattura"
    : status === 403 ? "permessi insufficienti sul collegamento con Fatture in Cloud: ricollegalo da Impostazioni fattura"
    : status === 404 ? "documento non trovato su Fatture in Cloud (cancellato o di un'altra azienda)"
    : status === 422 ? "Fatture in Cloud ha rifiutato la modifica dei pagamenti"
    : status === 429 ? "troppe richieste a Fatture in Cloud: riprova tra poco"
    : `risposta inattesa da Fatture in Cloud (${status})`;
  return d && (status === 422 || status >= 500 || status === 400) ? `${base}: ${d}` : base;
}

export interface MarkResult { ok: boolean; changed: boolean; kind: "synced" | "already" | "partial" | "error"; message: string }

const headers = (cfg: FicCfg, json = false) => ({ Authorization: `Bearer ${cfg.accessToken}`, Accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}) });
const enc = encodeURIComponent;
const call = (url: string, init: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
const readJson = async (res: Response) => { const t = await res.text(); try { return t ? JSON.parse(t) : {}; } catch { return {}; } };

/** Conto di pagamento da usare dove una voce non ne ha: il primo non virtuale (altrimenti il primo). null se non ce ne sono. */
async function pickPaymentAccount(cfg: FicCfg): Promise<{ id: number | null; err?: string }> {
  const res = await call(`${FIC_API_BASE}/c/${enc(cfg.companyId)}/info/payment_accounts`, { headers: headers(cfg) });
  const json = await readJson(res);
  if (!res.ok) return { id: null, err: ficHttpMessage(res.status, json) };
  const list = (Array.isArray((json as { data?: unknown }).data) ? (json as { data: { id?: number; virtual?: boolean }[] }).data : []).filter((a) => a?.id != null);
  const acc = list.find((a) => !a.virtual) ?? list[0];
  return { id: acc?.id ?? null };
}

/** Controlla la risposta del PUT: stati attesi e documento ancora completo di voci. */
function checkPutResponse(json: unknown, wantPaid: boolean): string | null {
  const d = (json as { data?: { payments_list?: FicPaymentItem[]; items_list?: unknown[] } })?.data;
  if (!d) return null;
  if (Array.isArray(d.items_list) && d.items_list.length === 0) return "attenzione: Fatture in Cloud ha restituito il documento senza righe, controllalo";
  const live = (d.payments_list ?? []).filter((p) => statusOf(p) !== "reversed");
  if (live.length && live.some((p) => (statusOf(p) === "paid") !== wantPaid)) return "Fatture in Cloud ha accettato la richiesta ma lo stato dei pagamenti non risulta aggiornato";
  return null;
}

/**
 * Segna come pagato (o non pagato) il documento FIC. Non lancia mai: restituisce sempre un MarkResult.
 * paid:true  → se l'incasso Xenora (amountEur) copre tutto il totale FIC: voci not_paid → paid; altrimenti non tocca nulla.
 * paid:false → le voci paid tornano not_paid.
 */
export async function markFicPayment(cfg: FicCfg, ficDocId: string | number, o: { paid: boolean; amount?: number; paidDate?: string }): Promise<MarkResult> {
  const err = (message: string): MarkResult => ({ ok: false, changed: false, kind: "error", message });
  const id = String(ficDocId).replace(/^fic:/, "");
  if (!/^\d+$/.test(id)) return err("riferimento del documento non valido");
  const url = `${FIC_API_BASE}/c/${enc(cfg.companyId)}/issued_documents/${id}`;
  try {
    const g = await call(`${url}?fieldset=detailed`, { headers: headers(cfg) });
    const gj = await readJson(g);
    if (!g.ok) return err(ficHttpMessage(g.status, gj));
    const list = ((gj as { data?: { payments_list?: FicPaymentItem[] } }).data?.payments_list ?? []) as FicPaymentItem[];
    const paidDate = (o.paidDate || todayRome()).slice(0, 10);

    let plan = planFicPayment(list, { paid: o.paid, amountEur: o.amount, paidDate });
    if (plan.action === "need_account") {
      const acc = await pickPaymentAccount(cfg);
      if (acc.err) return err(acc.err);
      plan = planFicPayment(list, { paid: o.paid, amountEur: o.amount, paidDate, accountId: acc.id });
      if (plan.action === "need_account") return err(plan.message);
    }
    if (plan.action === "partial") return { ok: true, changed: false, kind: "partial", message: plan.message };
    if (plan.action === "noop") return { ok: true, changed: false, kind: "already", message: plan.message };
    if (plan.action !== "update") return err("esito non previsto");

    const p = await call(url, { method: "PUT", headers: headers(cfg, true), body: JSON.stringify({ data: { payments_list: plan.payments } }) });
    const pj = await readJson(p);
    if (!p.ok) return err(ficHttpMessage(p.status, pj));
    const warn = checkPutResponse(pj, o.paid);
    return { ok: !warn, changed: true, kind: warn ? "error" : "synced", message: warn ?? plan.message };
  } catch (e) {
    const m = (e as Error)?.name === "TimeoutError" ? "Fatture in Cloud non ha risposto in tempo" : "Fatture in Cloud non raggiungibile";
    return err(m);
  }
}

/** Oggi (AAAA-MM-GG) nel fuso italiano. */
export function todayRome(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
