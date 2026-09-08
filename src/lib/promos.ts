// Libreria promo riutilizzabili, condivisa tra Promozioni, Ospiti e scheda ospite.
export interface Promo {
  id: string;
  name: string;
  subject: string;
  body: string; // supporta {nome} {sconto} {codice} {scadenza} {struttura} {contatti}
  description?: string; // breve descrizione dell'offerta (mostrata sul sito)
  features?: string[];  // elenco puntato di condizioni/vantaggi
  discountPct?: number;
  code?: string;
  validUntil?: string; // scadenza offerta (ISO)
  createdAt?: string;
}

const KEY = "spigolestay:promos";

// Promo di esempio, caricate in automatico alla prima apertura di «Promozioni».
export const DEFAULT_PROMOS: Promo[] = [
  {
    id: "promo-pasqua", name: "Weekend Pasqua", subject: "Weekend di Pasqua — offerta speciale",
    description: "Offerta speciale per il weekend di Pasqua.",
    discountPct: 15, code: "PASQUA15",
    features: ["Convenzione con ristorante per il pranzo di Pasqua", "Self check-in", "Minimo 2 notti", "Deluxe o Family Room", "Colazione inclusa", "Parcheggio gratuito *", "Wi-Fi"],
    body: "Ciao {nome},\n\nper il weekend di Pasqua ti riserviamo il {sconto}% di sconto con il codice {codice}.\n\n- Convenzione con ristorante per il pranzo di Pasqua\n- Self check-in\n- Minimo 2 notti\n- Deluxe o Family Room\n- Colazione inclusa\n- Parcheggio gratuito*\n- Wi-Fi\n\nPrenota direttamente su {struttura}. {contatti}",
  },
  {
    id: "promo-nottegratis", name: "Notte Gratis", subject: "6 notti + 1 in omaggio",
    description: "Soggiorna 6 notti, la settima è in omaggio.",
    discountPct: 100, code: "FREENIGHT",
    features: ["6 notti + 1 in omaggio", "Self check-in", "Deluxe Room con bagno privato", "Prenotazione anticipata", "Cancellazione gratuita fino a 7 giorni prima", "Colazione inclusa", "Parcheggio gratuito *", "Wi-Fi"],
    body: "Ciao {nome},\n\nprenota 6 notti e la settima è in omaggio (codice {codice}).\n\n- 6 notti + 1 in omaggio\n- Self check-in\n- Deluxe Room con bagno privato\n- Prenotazione anticipata\n- Cancellazione gratuita fino a 7 giorni prima\n- Colazione inclusa\n- Parcheggio gratuito*\n- Wi-Fi\n\nPrenota su {struttura}. {contatti}",
  },
  {
    id: "promo-lastminute", name: "Last Minute", subject: "Offerta Last Minute",
    description: "Parti a breve e risparmia con il last minute.",
    discountPct: 10, code: "LASTMIN10",
    features: ["Prenotazione entro 1 giorno prima", "Self check-in", "Minimo 2 notti", "Deluxe Room con bagno privato", "Colazione inclusa", "Parcheggio gratuito *", "Wi-Fi"],
    body: "Ciao {nome},\n\ncon il last minute hai il {sconto}% di sconto (codice {codice}).\n\n- Prenotazione entro 1 giorno prima\n- Self check-in\n- Minimo 2 notti\n- Deluxe Room con bagno privato\n- Colazione inclusa\n- Parcheggio gratuito*\n- Wi-Fi\n\nPrenota su {struttura}. {contatti}",
  },
];

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
