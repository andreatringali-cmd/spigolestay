// Riconoscere LO STESSO ospite. Una scheda per persona, con dentro tutto lo storico delle prenotazioni.
// Serve all'importazione (riusare la scheda invece di crearne una per prenotazione) e all'unione dei doppioni.
//
// Regole:
//  - stessa email REALE = stessa persona (le email "anonime" di Booking/Airbnb/Expedia cambiano a ogni prenotazione: non contano);
//  - stesso telefono = stessa persona;
//  - stesso nome (anche corto, da 3 lettere) = stessa persona, a meno che i dati dicano il contrario:
//    paesi diversi (IT contro DE) o due email reali diverse.

const GENERIC = /^(ospite|ospite da ics|non disponibile|camere importate|guest|sconosciuto|n a)$/; // confrontato col nome GIÀ normalizzato

// Domini di posta "di inoltro" dei portali: ogni prenotazione ne riceve uno diverso, quindi non identificano la persona.
const RELAY_DOMAINS = ["guest.booking.com", "booking.com", "m.airbnb.com", "guest.airbnb.com", "marketplace.airbnb.com", "airbnb.com", "expediapartnercentral.com", "expedia.com", "vrbo.com", "agoda.com", "hotelbeds.com"];

export const normName = (s?: string) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Ultime 9 cifre: ignora +39 / 0039 / zero iniziale. */
export const normPhone = (s?: string) => { const d = (s ?? "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; };

export interface GuestLike { id?: string; fullName?: string; email?: string; phone?: string; country?: string }

/** Email vera della persona (minuscola), oppure "" se manca o è un indirizzo di inoltro di un portale. */
export function realEmail(email?: string): string {
  const e = (email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return "";
  const dom = e.split("@")[1] ?? "";
  return RELAY_DOMAINS.some((d) => dom === d || dom.endsWith("." + d)) ? "" : e;
}

/** Nome utilizzabile per riconoscere una persona: non vuoto, non generico, almeno 3 lettere. */
export function usableName(fullName?: string): string {
  const n = normName(fullName);
  if (n.replace(/ /g, "").length < 3 || GENERIC.test(n)) return "";
  return n;
}

/**
 * Chiave per ritrovare un ospite già esistente durante l'importazione: email reale, poi nome (+ paese), poi telefono.
 * null = non abbastanza dati per riconoscerlo con sicurezza.
 */
export function guestKey(g: GuestLike): string | null {
  const email = realEmail(g.email);
  if (email) return "e:" + email;
  const n = usableName(g.fullName);
  if (n) return "n:" + n + "|" + (g.country ?? "").trim().toLowerCase();
  const ph = normPhone(g.phone);
  return ph ? "t:" + ph : null;
}

/** Vero se la chiave viene dal solo nome (nessun contatto): meno sicura. */
export const isNameKey = (k: string | null) => !!k && k.startsWith("n:");

/**
 * Raggruppa le schede che sono la stessa persona (gruppi con almeno 2 schede), unendo per email reale, telefono e nome compatibile.
 * Due schede con lo stesso nome restano separate solo se i paesi sono diversi o le email reali sono diverse.
 */
export function groupDuplicates<T extends GuestLike & { id: string }>(guests: T[]): T[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; let c = x; while (parent.get(c) !== r) { const nx = parent.get(c)!; parent.set(c, r); c = nx; } return r; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  guests.forEach((g) => parent.set(g.id, g.id));

  const byEmail = new Map<string, string>(), byPhone = new Map<string, string>();
  const byName = new Map<string, T[]>();
  for (const g of guests) {
    const em = realEmail(g.email);
    if (em) { const f = byEmail.get(em); if (f) union(f, g.id); else byEmail.set(em, g.id); }
    const ph = normPhone(g.phone);
    if (ph) { const f = byPhone.get(ph); if (f) union(f, g.id); else byPhone.set(ph, g.id); }
    const n = usableName(g.fullName);
    if (n) { const arr = byName.get(n); if (arr) arr.push(g); else byName.set(n, [g]); }
  }
  // Stesso nome: si uniscono i compatibili (paese vuoto o uguale, nessuna email reale diversa).
  for (const arr of byName.values()) {
    if (arr.length < 2) continue;
    const clusters: { ids: string[]; countries: Set<string>; emails: Set<string> }[] = [];
    for (const g of arr) {
      const country = (g.country ?? "").trim().toLowerCase();
      const em = realEmail(g.email);
      const home = clusters.find((c) => (!country || c.countries.size === 0 || c.countries.has(country)) && (!em || c.emails.size === 0 || c.emails.has(em)));
      if (home) { home.ids.push(g.id); if (country) home.countries.add(country); if (em) home.emails.add(em); }
      else clusters.push({ ids: [g.id], countries: new Set(country ? [country] : []), emails: new Set(em ? [em] : []) });
    }
    for (const c of clusters) for (let i = 1; i < c.ids.length; i++) union(c.ids[0], c.ids[i]);
  }
  const groups = new Map<string, T[]>();
  for (const g of guests) { const r = find(g.id); const arr = groups.get(r); if (arr) arr.push(g); else groups.set(r, [g]); }
  return [...groups.values()].filter((a) => a.length > 1);
}

/** Scompone il nome completo in Nome e Cognome: la prima parola è il nome, il resto il cognome (stessa regola della scheda prenotazione).
 *  Con una sola parola va nel cognome. L'ordine nei dati importati non è sempre quello: la scheda ha il pulsante "Inverti". */
export function splitName(fullName?: string): { firstName: string; lastName: string } {
  const t = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return { firstName: "", lastName: "" };
  if (t.length === 1) return { firstName: "", lastName: t[0] };
  return { firstName: t[0], lastName: t.slice(1).join(" ") };
}

/** Le schede create dall'importazione hanno solo il nome completo: per mostrarle nei campi Nome e Cognome li ricava da lì. */
export function withSplitNames<T extends { fullName?: string; firstName?: string; lastName?: string }>(g: T): T {
  if ((g.firstName ?? "").trim() || (g.lastName ?? "").trim() || !(g.fullName ?? "").trim()) return g;
  return { ...g, ...splitName(g.fullName) };
}
