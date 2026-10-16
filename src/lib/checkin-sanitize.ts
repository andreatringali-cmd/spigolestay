// Ripulitura dei dati che l'ospite (anonimo) manda a POST /api/checkin: finiscono nel blob del gestore,
// quindi ogni campo ha un tetto di lunghezza e una chiave nota. Funzioni pure (testabili senza rete).

export interface DocClean { firstName: string; lastName: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docType?: string; docNumber: string; docPlace?: string }

const cut = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Anagrafica dell'ospite principale con tetti di lunghezza (come per gli ospiti aggiuntivi). */
export function sanitizeDoc(raw: unknown): DocClean {
  const d = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    firstName: (cut(d.firstName, 80) ?? "").trim(), lastName: (cut(d.lastName, 80) ?? "").trim(),
    sex: cut(d.sex, 1) || undefined, birthDate: cut(d.birthDate, 20), birthPlace: cut(d.birthPlace, 120),
    citizenship: cut(d.citizenship, 80), docType: cut(d.docType, 60), docNumber: (cut(d.docNumber, 60) ?? "").trim(), docPlace: cut(d.docPlace, 120),
  };
}

const KINDS = ["privato", "societa", "estero"];
const INVOICE_TEXT: [string, number][] = [["name", 120], ["vat", 30], ["taxCode", 30], ["address", 160], ["city", 80], ["cap", 20], ["province", 20], ["country", 3], ["sdiCode", 20], ["pec", 120]];

/** Richiesta di fattura: solo le chiavi note (InvoiceRequest), testi tagliati; qualsiasi altra chiave è scartata. */
export function sanitizeInvoiceRequest(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { wants: r.wants === true };
  if (typeof r.kind === "string" && KINDS.includes(r.kind)) out.kind = r.kind;
  for (const [k, max] of INVOICE_TEXT) { const v = cut(r[k], max); if (v) out[k] = v; }
  return out;
}
