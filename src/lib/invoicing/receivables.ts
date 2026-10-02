// Crediti verso clienti (scadenzario): logica PURA, nessun import.
// Regola di coerenza: una nota di credito EMESSA che storna una fattura riduce il suo residuo
// (il DB non porta la fattura a "stornata" all'emissione della NC), e la NC stessa non è mai un credito.

export interface RecvDoc {
  id: string; doc_kind: string; stato: string; total_cents: number;
  due_date: string | null; related_document_id: string | null;
}
export interface Residuo { paid: number; credited: number; residuo: number }

const VALID = new Set(["emessa", "inviata_intermediario", "consegnata"]);

export function computeResidui(docs: RecvDoc[], paidById: Record<string, number>): Record<string, Residuo> {
  const credited: Record<string, number> = {};
  for (const d of docs) {
    if (d.doc_kind === "nota_di_credito" && VALID.has(d.stato) && d.related_document_id) {
      credited[d.related_document_id] = (credited[d.related_document_id] ?? 0) + d.total_cents;
    }
  }
  const out: Record<string, Residuo> = {};
  for (const d of docs) {
    const paid = paidById[d.id] ?? 0;
    const cr = credited[d.id] ?? 0;
    out[d.id] = { paid, credited: cr, residuo: d.total_cents - paid - cr };
  }
  return out;
}

// Data locale di oggi (YYYY-MM-DD), senza lo slittamento UTC di toISOString().
export function todayLocalISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// Giorni di ritardo (0 se non scaduto o senza scadenza).
export function daysOverdue(due: string | null, today: string): number {
  if (!due || due >= today) return 0;
  const a = Date.UTC(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export type AgingKey = "future" | "nodue" | "d30" | "d60" | "d90" | "over90";
export const AGING_LABEL: Record<AgingKey, string> = {
  future: "Non ancora scaduto", nodue: "Senza scadenza", d30: "Scaduto 1–30 gg", d60: "Scaduto 31–60 gg", d90: "Scaduto 61–90 gg", over90: "Scaduto oltre 90 gg",
};
export function agingBucket(due: string | null, today: string): AgingKey {
  if (!due) return "nodue";
  const d = daysOverdue(due, today);
  if (d <= 0) return "future";
  if (d <= 30) return "d30";
  if (d <= 60) return "d60";
  if (d <= 90) return "d90";
  return "over90";
}
