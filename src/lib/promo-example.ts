// Promozioni «di esempio»: quelle precaricate da Xenora (Weekend Pasqua, Notte Gratis, Last Minute, Riprenota diretto).
// Sono modelli da adattare, NON offerte vere della struttura: non devono mai comparire sul sito pubblico, nel motore di
// prenotazione (il codice sconto non vale) né nei dati pubblicati. Diventano vere solo quando il titolare le modifica e salva.
// File senza dipendenze (usato sia da promos.ts sia da publicdata.ts: nessun import circolare).

/** Firma delle promo precaricate: id fisso + nome/sconto/codice originali. */
const EXAMPLE_SIGNATURES: Record<string, { name: string; discountPct: number; code: string }> = {
  "promo-pasqua": { name: "Weekend Pasqua", discountPct: 15, code: "PASQUA15" },
  "promo-nottegratis": { name: "Notte Gratis", discountPct: 100, code: "FREENIGHT" },
  "promo-lastminute": { name: "Last Minute", discountPct: 10, code: "LASTMIN10" },
  "promo-riprenota": { name: "Riprenota diretto", discountPct: 10, code: "RITORNO10" },
};

interface PromoLike { id?: string; name?: string; discountPct?: number; code?: string; example?: boolean }

/**
 * true = promo di esempio (non pubblicabile).
 *  - `example` esplicito vince (true = esempio, false = il titolare l'ha salvata: è vera);
 *  - altrimenti (dati salvati prima di questa regola) è di esempio se ha l'id di una promo precaricata e nome, sconto e codice
 *    sono ancora quelli originali.
 */
export function isExamplePromo(p: PromoLike | null | undefined): boolean {
  if (!p) return false;
  if (p.example === true) return true;
  if (p.example === false) return false;
  const sig = p.id ? EXAMPLE_SIGNATURES[p.id] : undefined;
  return !!sig && p.name === sig.name && p.discountPct === sig.discountPct && p.code === sig.code;
}

/** Solo le promozioni vere (toglie quelle di esempio). */
export function realPromos<T extends PromoLike>(list: T[]): T[] {
  return list.filter((p) => !isExamplePromo(p));
}
