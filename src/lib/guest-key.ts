// Chiave per riconoscere LO STESSO ospite: contatto forte (email, poi telefono) e, solo se manca, nome + paese.
// Serve all'importazione (riusare la scheda invece di crearne una per prenotazione) e all'unione dei doppioni.

const GENERIC = /^(ospite|ospite da ics|non disponibile|camere importate|guest|sconosciuto|n a)$/; // confrontato col nome GIA normalizzato

export const normName = (s?: string) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Ultime 9 cifre: ignora +39 / 0039 / zero iniziale. */
export const normPhone = (s?: string) => { const d = (s ?? "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; };

export interface GuestLike { fullName?: string; email?: string; phone?: string; country?: string }

/** null = non abbastanza dati per riconoscerlo con sicurezza (nome troppo breve o generico, senza contatti). */
export function guestKey(g: GuestLike): string | null {
  const email = (g.email ?? "").trim().toLowerCase();
  if (email) return "e:" + email;
  const ph = normPhone(g.phone);
  if (ph) return "t:" + ph;
  const n = normName(g.fullName);
  if (n.length < 5 || GENERIC.test(n)) return null;
  return "n:" + n + "|" + (g.country ?? "").trim().toLowerCase();
}

/** Vero se la chiave viene dal solo nome (nessun contatto): meno sicura, usata con più cautela. */
export const isNameKey = (k: string | null) => !!k && k.startsWith("n:");
