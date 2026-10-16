// Telefono dell'ospite scomposto in prefisso + numero (scheda ospite). Funzioni pure, testate in tests/guest-phone.test.ts.
// Regola: un prefisso non in elenco NON viene mai riscritto come +39: il numero resta intero con prefisso vuoto ("Altro").

// Prefissi internazionali: il numero va salvato in formato internazionale (+39 …),
// altrimenti WhatsApp (wa.me) non riconosce il numero e il link non si apre.
export const DIAL_CODES: [string, string][] = [
  ["+39", "🇮🇹 Italia"], ["+41", "🇨🇭 Svizzera"], ["+44", "🇬🇧 Regno Unito"], ["+33", "🇫🇷 Francia"],
  ["+49", "🇩🇪 Germania"], ["+34", "🇪🇸 Spagna"], ["+43", "🇦🇹 Austria"], ["+32", "🇧🇪 Belgio"],
  ["+31", "🇳🇱 Paesi Bassi"], ["+351", "🇵🇹 Portogallo"], ["+353", "🇮🇪 Irlanda"], ["+30", "🇬🇷 Grecia"],
  ["+45", "🇩🇰 Danimarca"], ["+46", "🇸🇪 Svezia"], ["+47", "🇳🇴 Norvegia"], ["+358", "🇫🇮 Finlandia"],
  ["+48", "🇵🇱 Polonia"], ["+420", "🇨🇿 Rep. Ceca"], ["+36", "🇭🇺 Ungheria"], ["+40", "🇷🇴 Romania"],
  ["+1", "🇺🇸 USA / Canada"], ["+7", "🇷🇺 Russia"], ["+380", "🇺🇦 Ucraina"], ["+90", "🇹🇷 Turchia"],
  ["+61", "🇦🇺 Australia"], ["+81", "🇯🇵 Giappone"], ["+86", "🇨🇳 Cina"], ["+55", "🇧🇷 Brasile"],
];
const DIALS_BY_LEN = DIAL_CODES.map((d) => d[0]).sort((a, b) => b.length - a.length);

/** `country` (opzionale, codice a 2 lettere) serve solo per i numeri senza "+": se è un Paese diverso dall'Italia non si presume +39. */
export function parsePhone(raw?: string, country?: string): { dial: string; local: string } {
  const s = (raw ?? "").trim();
  if (!s) return { dial: "+39", local: "" };
  const norm = s.startsWith("00") ? "+" + s.slice(2) : s;
  if (norm.startsWith("+")) {
    for (const d of DIALS_BY_LEN) if (norm.startsWith(d)) return { dial: d, local: norm.slice(d.length).trim() };
    // Prefisso non in elenco (+212, +971, +91…): il numero resta intero, senza prefisso scelto.
    return { dial: "", local: s };
  }
  // Formato OTA (Booking/Airbnb) "prefisso-zona-numero-" (es. "39--3934335777-"): già interpretato da checkPhone, non va riscritto come +39.
  if (/^\d{1,3}-\d{0,5}-\d{3,}-$/.test(s)) return { dial: "", local: s };
  const c = (country ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c) && c !== "IT") return { dial: "", local: s };
  return { dial: "+39", local: s };
}

export const combinePhone = (dial: string, local: string) => { const loc = local.trim(); return loc ? (dial ? `${dial} ${loc}` : loc) : ""; };
