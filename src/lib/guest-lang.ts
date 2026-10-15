// Lingua con cui scrivere a un ospite (messaggi di check-in, pagamento, guida, recensione, check-out…): it · en · fr · de · es.
// Prima la lingua impostata a mano nella scheda ospite; se manca (gli ospiti che arrivano dalle OTA non ce l'hanno) si ricava dal Paese
// (che le OTA mandano come codice, es. "NL", "GB") e, in mancanza, dal prefisso del telefono (vedi phone-country.ts). Un Paese straniero non in elenco → inglese.
// Senza alcun dato resta l'italiano, come prima. Puro.

import { langFromCountry, langFromPhone, countryFromPhone, normalizePhone, type GuestLang } from "./phone-country";

export type { GuestLang };
const SUPPORTED: GuestLang[] = ["it", "en", "fr", "de", "es"];

// Alcune OTA/moduli mandano il nome del Paese invece del codice: i più comuni.
const COUNTRY_NAME: Record<string, string> = {
  ITALIA: "IT", ITALY: "IT", ITALIE: "IT", ITALIEN: "IT",
  GERMANIA: "DE", GERMANY: "DE", ALLEMAGNE: "DE", DEUTSCHLAND: "DE", ALEMANIA: "DE", AUSTRIA: "AT", "ÖSTERREICH": "AT", SVIZZERA: "CH", SWITZERLAND: "CH", SUISSE: "CH", SCHWEIZ: "CH",
  FRANCIA: "FR", FRANCE: "FR", FRANKREICH: "FR",
  SPAGNA: "ES", SPAIN: "ES", "ESPAÑA": "ES", ESPAGNE: "ES", SPANIEN: "ES",
  "REGNO UNITO": "GB", "UNITED KINGDOM": "GB", UK: "GB", INGHILTERRA: "GB", ENGLAND: "GB", "STATI UNITI": "US", "UNITED STATES": "US", USA: "US",
};

/** Codice Paese ISO-2 dal campo "country" dell'ospite (codice o nome comune), o "" se non riconoscibile. */
export function countryCodeOf(raw?: string | null): string {
  const c = String(raw ?? "").trim().toUpperCase();
  if (!c) return "";
  if (/^[A-Z]{2}$/.test(c)) return c;
  return COUNTRY_NAME[c] ?? "";
}

export interface GuestLangInput { language?: string | null; lang?: string | null; country?: string | null; phone?: string | null }

/** Paese dell'ospite: quello della scheda se c'è, altrimenti dal prefisso del telefono. null se non si sa. */
export function guestCountryOf(g?: GuestLangInput | null): string | null {
  return countryCodeOf(g?.country) || countryFromPhone(g?.phone);
}

export function guestLangOf(g?: GuestLangInput | null): GuestLang {
  const explicit = String(g?.language || g?.lang || "").slice(0, 2).toLowerCase();
  if ((SUPPORTED as string[]).includes(explicit)) return explicit as GuestLang;

  const c = countryCodeOf(g?.country);
  if (c) return langFromCountry(c);

  return langFromPhone(g?.phone) ?? "it";
}

/**
 * Lingua da suggerire a chi sceglie da sé (es. il concierge, che di solito la ricava dal testo dell'ospite): la lingua della scheda,
 * altrimenti quella ricavata da Paese/prefisso SOLO se non è l'italiano (senza dati resta "nessun suggerimento", come prima).
 */
export function guestLangHint(g?: GuestLangInput | null): string | undefined {
  const explicit = String(g?.language || g?.lang || "").trim();
  if (explicit) return explicit;
  const l = guestLangOf(g);
  return l === "it" ? undefined : l;
}

/** Come guestLangOf, ma null quando non c'è NESSUN dato (né lingua, né Paese, né telefono): allora la pagina usa la lingua del browser. */
export function guestLangOrNull(g?: GuestLangInput | null): GuestLang | null {
  const hasSignal = !!(String(g?.language || g?.lang || "").trim() || countryCodeOf(g?.country) || normalizePhone(g?.phone).digits);
  return hasSignal ? guestLangOf(g) : null;
}
