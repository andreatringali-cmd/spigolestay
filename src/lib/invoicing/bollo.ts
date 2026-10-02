// Registro bollo: raggruppamento per trimestre e scadenze di versamento. Puro, senza import.
//
// Scadenze e codici tributo per l'imposta di bollo sulle fatture elettroniche (F24):
//   I trim. 31 maggio (2521) · II trim. 30 settembre (2522) · III trim. 30 novembre (2523) · IV trim. 28 febbraio anno dopo (2524).
//   Se l'importo dovuto per il I trimestre (o I+II) non supera 250 €, il versamento si può posticipare alla scadenza successiva.
// ATTENZIONE: riferimento indicativo, NON verificato in questa sessione contro la normativa vigente: in UI
// va mostrato come "da confermare con il commercialista".

export const BOLLO_FREE_LIMIT_CENTS = 25000; // 250 €

export interface BolloRow { issue_date: string | null; bollo_cents: number }

export const quarterOf = (iso: string | null): number => { const m = Number((iso ?? "").slice(5, 7)); return m >= 1 && m <= 12 ? Math.ceil(m / 3) : 0; };

export interface QuarterInfo { q: number; count: number; cents: number; dueDate: string; tributo: string; postponable: boolean }

export function bolloQuarters(rows: BolloRow[], year: number): QuarterInfo[] {
  const dues = [`${year}-05-31`, `${year}-09-30`, `${year}-11-30`, `${year + 1}-02-28`];
  const tributi = ["2521", "2522", "2523", "2524"];
  const base = [1, 2, 3, 4].map((q) => {
    const list = rows.filter((r) => (r.issue_date ?? "").slice(0, 4) === String(year) && quarterOf(r.issue_date) === q);
    return { q, count: list.length, cents: list.reduce((a, r) => a + r.bollo_cents, 0) };
  });
  return base.map((b, i) => ({
    ...b, dueDate: dues[i], tributo: tributi[i],
    // I trim. ≤ 250 € → rinviabile; II trim.: rinviabile se I+II ≤ 250 €. III/IV mai.
    postponable: i === 0 ? b.cents > 0 && b.cents <= BOLLO_FREE_LIMIT_CENTS : i === 1 ? b.cents > 0 && base[0].cents + b.cents <= BOLLO_FREE_LIMIT_CENTS : false,
  }));
}
