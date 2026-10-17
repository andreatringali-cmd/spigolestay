// Piccole utilità pure per l'invio (route /api/email): validazione indirizzi, intestazione From, pulizia dei campi in ingresso.
// Stanno qui (e non nella route) perché Next.js non ammette export extra dai file route.ts, e così si possono provare con i test.

/** Testo su una riga, senza spazi doppi, al massimo `max` caratteri. */
export const str = (v: unknown, max = 300): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Sito web da MOSTRARE (anche "www.esempio.it" senza schema): niente spazi/virgolette/angolari. */
export const cleanWebsite = (v: unknown): string | undefined => { const s = str(v, 200); return s && /^[^\s"'<>]+$/.test(s) ? s : undefined; };

// Indirizzo email "semplice": una sola chiocciola, niente spazi/virgole/angolari, dominio con un punto. Evita header injection e destinatari multipli.
const EMAIL_RE = /^[^\s@<>",;:\\()[\]]+@[^\s@<>",;:\\()[\]]+\.[^\s@<>",;:\\()[\]]{2,}$/;
export const validEmail = (s: unknown): s is string => typeof s === "string" && s.trim().length <= 254 && EMAIL_RE.test(s.trim());

/** Solo l'indirizzo di una variabile tipo RESEND_FROM ("Nome <a@b.it>" oppure "a@b.it"). */
export const addressOnly = (from: string): string => (from.match(/<([^>]+)>/)?.[1] ?? from).trim();

/** Intestazione From con il nome VISUALIZZATO tra virgolette (RFC 5322): un nome con virgola come "Casa Rossi, Siracusa" non spezza l'indirizzo. */
export function fromHeader(name: string | undefined, address: string): string {
  const n = String(name || "Xenora").replace(/[\r\n\t]+/g, " ").replace(/[<>]/g, "").replace(/(["\\])/g, "\\$1").replace(/\s+/g, " ").trim().slice(0, 80) || "Xenora";
  return `"${n}" <${address}>`;
}

/**
 * Lingua probabile dell'ospite dal solo dominio dell'indirizzo (ultima risorsa, quando il messaggio non porta `lang` né dati ospite):
 * .de/.at → tedesco, .fr → francese, .es → spagnolo, .uk → inglese. Domini generici (.com, gmail…) o .it → nessuna indicazione.
 */
export function langFromEmailDomain(email: unknown): "en" | "fr" | "de" | "es" | undefined {
  const m = /@[^@\s]*\.([a-z]{2,})$/i.exec(String(email ?? "").trim());
  const tld = (m?.[1] ?? "").toLowerCase();
  return tld === "de" || tld === "at" ? "de" : tld === "fr" ? "fr" : tld === "es" ? "es" : tld === "uk" ? "en" : undefined;
}
