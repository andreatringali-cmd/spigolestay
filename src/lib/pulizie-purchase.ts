// Acquisti dell'addetta (Materiale acquistato) — logica PURA (nessun I/O, testabile):
//  - scontrino allegato: validazione del file (tipo/dimensione/firma), percorso su Storage e controllo che appartenga all'account;
//  - collegamento alla Prima nota (Cassa): da un acquisto con importo nasce UN movimento di uscita. L'id del movimento è l'id
//    dell'acquisto (UUID): così la scrittura è idempotente (stesso acquisto = stesso movimento) e dalla Cassa si risale all'acquisto
//    (e quindi allo scontrino) senza colonne nuove sul database.
import type { CashRow } from "./purchases";
import { isUuid, newUuid, sniffMediaType } from "./media";
import type { CashLink, PulizieOrder, ReceiptRef } from "./pulizie-addetta";

// ---- scontrino ------------------------------------------------------------------------------------------------------------
export const RECEIPT_BUCKET = "receipts";
/** Le funzioni serverless di Vercel accettano al massimo ~4,5 MB di corpo: restiamo sotto (le foto vengono ridotte a poche centinaia di KB). */
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
export const RECEIPT_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
export const RECEIPT_ACCEPT = "image/*,application/pdf";
export const RECEIPT_MAX_SIDE = 1600;
export const RECEIPT_JPEG_QUALITY = 0.72;
export const RECEIPT_SIGNED_SECONDS = 300;

export type FileCheck = { ok: true; ext: string; type: string } | { ok: false; error: string };

/** Il file (tipo dichiarato + dimensione) è accettabile come scontrino? */
export function validateReceiptFile(f: { type: string; size: number }): FileCheck {
  const type = (f.type || "").toLowerCase().split(";")[0].trim();
  const ext = RECEIPT_TYPES[type];
  if (!ext) return { ok: false, error: "Formato non ammesso: usa una foto (JPG, PNG, WebP) o un PDF." };
  if (!Number.isFinite(f.size) || f.size <= 0) return { ok: false, error: "Il file è vuoto." };
  if (f.size > RECEIPT_MAX_BYTES) return { ok: false, error: `Il file è troppo grande (massimo ${Math.round(RECEIPT_MAX_BYTES / 1024 / 1024)} MB).` };
  return { ok: true, ext, type };
}

/** Tipo reale del file dai primi byte (non ci si fida del tipo dichiarato dal browser). Usa il rilevatore comune di media.ts, ma gli scontrini non ammettono GIF. */
export function sniffReceiptType(b: Uint8Array): string | null {
  const t = sniffMediaType(b);
  return t === "image/gif" ? null : t;
}

// UUID: definiti in media.ts (stessa logica), qui riesportati per non rompere gli import esistenti.
export { isUuid, newUuid };

/** Percorso del file nel bucket privato: <tenantId>/<uuid>.<ext>. */
export const receiptPathFor = (tenantId: string, fileId: string, ext: string): string => `${tenantId}/${fileId}.${ext}`;
/** Il percorso appartiene all'account (prima cartella = tenantId, nome file regolare, nessun "..")? */
export function isReceiptPathOf(tenantId: string, path: unknown): path is string {
  if (typeof path !== "string" || !isUuid(tenantId)) return false;
  const m = path.match(/^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp|pdf)$/i);
  return !!m && m[1].toLowerCase() === tenantId.toLowerCase() && isUuid(m[2]);
}
/** Nome file da mostrare: senza percorsi né caratteri di controllo, al massimo 80 caratteri. */
export function cleanFileName(name: string | undefined): string {
  const base = (name || "").split(/[\\/]/).pop() || "";
  const s = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (s || "scontrino").slice(0, 80);
}

/** Dimensioni dopo la riduzione: il lato lungo non supera `max`, le proporzioni restano; mai ingrandire. */
export function fitWithin(w: number, h: number, max: number = RECEIPT_MAX_SIDE): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

// ---- pagamento ---------------------------------------------------------------------------------------------------------------
/** "Pagato con" → conto della Cassa (chiavi dei conti di base). */
export const PAY_OPTIONS = [
  { key: "contanti", label: "Contanti" },
  { key: "carta", label: "Carta" },
  { key: "banca", label: "Bonifico" },
] as const;
export const DEFAULT_PAY_CONTO = "contanti";
export const PURCHASE_CASH_CAT = "forniture"; // categoria della Cassa: "Forniture" (materiale di consumo)
const ALLOWED_CONTI: ReadonlySet<string> = new Set(PAY_OPTIONS.map((o) => o.key));
// Conti PER STRUTTURA: oltre ai tre di base valgono i conti creati in Cassa (chiavi "conto-...", "contanti@...", "carta@...", "banca@..."); qualunque altra cosa → contanti.
const STRUCT_CONTO = /^(conto-|contanti@|carta@|banca@)[a-z0-9@_-]{1,100}$/;
export const normalizePayConto = (c: unknown): string => (typeof c === "string" && (ALLOWED_CONTI.has(c) || STRUCT_CONTO.test(c)) ? c : DEFAULT_PAY_CONTO);

// ---- acquisto → movimento di Prima nota ---------------------------------------------------------------------------------------
export const purchaseDescription = (name: string, qty: number): string => `Materiale: ${name.trim().replace(/\s+/g, " ")} × ${String(qty).replace(".", ",")}`;

export interface PurchaseInput { id: string; date: string; name: string; qty: number; cost: number | undefined; structureId?: string; conto?: string }
export type BuiltMovement = { ok: true; row: CashRow } | { ok: false; error: string };

/**
 * Movimento di USCITA della Prima nota per un acquisto. Senza importo (o a zero) non si crea nulla.
 * id del movimento = id dell'acquisto: lo stesso acquisto dà sempre lo stesso movimento (idempotenza).
 */
export function buildPurchaseMovement(p: PurchaseInput, tenantId: string): BuiltMovement {
  if (!isUuid(tenantId)) return { ok: false, error: "account non valido" };
  if (!isUuid(p.id)) return { ok: false, error: "id acquisto non valido" };
  const cost = Number(p.cost);
  if (p.cost == null || !Number.isFinite(cost) || cost <= 0) return { ok: false, error: "nessun importo" };
  if (cost > 1_000_000) return { ok: false, error: "importo troppo alto" };
  const name = String(p.name ?? "").trim();
  if (!name || name.length > 120) return { ok: false, error: "voce non valida" };
  const qty = Number(p.qty);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 100_000) return { ok: false, error: "quantità non valida" };
  const date = String(p.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { ok: false, error: "data non valida" };
  const sid = p.structureId ? String(p.structureId) : "";
  if (sid.length > 80) return { ok: false, error: "struttura non valida" };
  return {
    ok: true,
    row: { id: p.id, tenant_id: tenantId, structure_id: sid || null, date, kind: "out", cat: PURCHASE_CASH_CAT, descr: purchaseDescription(name, qty), amount_cents: Math.round(cost * 100), conto: normalizePayConto(p.conto) },
  };
}

// ---- creazione dell'acquisto e allineamento con la Prima nota -----------------------------------------------------------------------
export interface NewPurchase { id: string; productId?: string; productName: string; structureId: string; date: string; qty: number; cost?: number; conto?: string; receipt?: ReceiptRef; nowMs: number }

/** Ordine di "Scorte & spesa" per un acquisto dell'addetta. Con un importo parte "da registrare in Prima nota" (cash = pending). */
export function createPurchaseOrder(p: NewPurchase): PulizieOrder {
  const hasCost = p.cost != null && Number.isFinite(p.cost) && p.cost > 0;
  const o: PulizieOrder = { id: p.id, productId: p.productId ?? "", productName: p.productName, structureId: p.structureId, date: p.date, qty: p.qty, cost: p.cost, source: "addetta", updatedAt: p.nowMs };
  if (p.receipt) o.receipt = p.receipt;
  if (hasCost) { o.payConto = normalizePayConto(p.conto); o.cash = "pending"; }
  return o;
}

/**
 * Cosa fare con la Prima nota:
 *  - da creare: acquisti nuovi (cash = pending) con importo, non eliminati;
 *  - da togliere: acquisti già registrati (cash = done) che nel frattempo sono stati eliminati.
 * Gli acquisti vecchi, senza il campo `cash`, NON vengono mai toccati (potrebbero essere già in Cassa a mano).
 */
export function planCashSync(orders: PulizieOrder[]): { create: PulizieOrder[]; remove: PulizieOrder[] } {
  const create = orders.filter((o) => !o._deleted && o.source === "addetta" && o.cash === "pending" && (o.cost ?? 0) > 0 && isUuid(o.id));
  const remove = orders.filter((o) => o._deleted && o.cash === "done" && isUuid(o.id));
  return { create, remove };
}

/** Segna l'esito sugli ordini indicati (aggiorna updatedAt così la fusione tra dispositivi tiene la versione nuova). */
export function markCash(orders: PulizieOrder[], ids: ReadonlySet<string>, state: CashLink, nowMs: number): PulizieOrder[] {
  return orders.map((o) => (ids.has(o.id) ? { ...o, cash: state, updatedAt: nowMs } : o));
}

/** Mappa id movimento → scontrino, per mostrare il link nella Prima nota (movimento e acquisto hanno lo stesso id). */
export function receiptsByMovement(orders: PulizieOrder[]): Map<string, ReceiptRef> {
  const m = new Map<string, ReceiptRef>();
  for (const o of orders) if (!o._deleted && o.receipt?.path && (o.cash === "done" || o.cash === "pending")) m.set(o.id, o.receipt);
  return m;
}
