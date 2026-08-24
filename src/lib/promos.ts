// Libreria promo riutilizzabili, condivisa tra Promozioni, Ospiti e scheda ospite.
export interface Promo {
  id: string;
  name: string;
  subject: string;
  body: string; // supporta {nome} {sconto} {codice} {scadenza} {struttura} {contatti}
  discountPct?: number;
  code?: string;
  validUntil?: string; // scadenza offerta (ISO)
  createdAt?: string;
}

const KEY = "spigolestay:promos";

export function loadPromos(): Promo[] {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
export function savePromos(list: Promo[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
export function newPromoId(): string {
  return (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
}
export function applyPromo(text: string, vars: { nome?: string; sconto?: number | string; codice?: string; scadenza?: string; struttura?: string; contatti?: string }): string {
  return (text ?? "")
    .replace(/{nome}/g, vars.nome ?? "")
    .replace(/{sconto}/g, vars.sconto != null ? String(vars.sconto) : "")
    .replace(/{codice}/g, vars.codice ?? "")
    .replace(/{scadenza}/g, vars.scadenza ?? "")
    .replace(/{struttura}/g, vars.struttura ?? "")
    .replace(/{contatti}/g, vars.contatti ?? "");
}
// Costruisce il link mailto per inviare una promo (destinatari in ccn).
export function promoMailto(emails: string[], promo: Promo, opts: { nome?: string; struttura?: string; contatti?: string } = {}): string {
  const scadenza = promo.validUntil ? new Date(promo.validUntil).toLocaleDateString("it-IT") : "";
  const body = applyPromo(promo.body, { nome: opts.nome, sconto: promo.discountPct, codice: promo.code, scadenza, struttura: opts.struttura, contatti: opts.contatti });
  const single = !!opts.nome && emails.length === 1;
  const to = single ? emails[0] : "";
  const bcc = single ? "" : emails.join(",");
  const parts = [`subject=${encodeURIComponent(promo.subject)}`, `body=${encodeURIComponent(body)}`];
  if (bcc) parts.unshift(`bcc=${encodeURIComponent(bcc)}`);
  return `mailto:${encodeURIComponent(to)}?${parts.join("&")}`;
}
