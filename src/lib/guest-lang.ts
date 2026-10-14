// Lingua con cui scrivere a un ospite (messaggi di check-in, pagamento, guida, recensione, check-out…): it · en · fr · de · es.
// Prima la lingua impostata a mano nella scheda ospite; se manca (gli ospiti che arrivano dalle OTA non ce l'hanno) si ricava dal Paese
// (che le OTA mandano come codice, es. "NL", "GB") e, in mancanza, dal prefisso del telefono. Un Paese straniero non in elenco → inglese.
// Senza alcun dato resta l'italiano, come prima. Puro, senza import.

export type GuestLang = "it" | "en" | "fr" | "de" | "es";
const SUPPORTED: GuestLang[] = ["it", "en", "fr", "de", "es"];

const COUNTRY_LANG: Record<string, GuestLang> = {
  IT: "it", SM: "it", VA: "it",
  DE: "de", AT: "de", LI: "de", CH: "de",
  FR: "fr", MC: "fr", LU: "fr",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", UY: "es", EC: "es", BO: "es", PY: "es", CR: "es", PA: "es", GT: "es", DO: "es", CU: "es",
};

// Prefissi telefonici internazionali → lingua (il più lungo che combacia vince).
const PHONE_LANG: [string, GuestLang][] = [
  ["39", "it"], ["378", "it"],
  ["49", "de"], ["43", "de"], ["41", "de"], ["423", "de"],
  ["33", "fr"], ["377", "fr"], ["352", "fr"],
  ["34", "es"], ["52", "es"], ["54", "es"], ["57", "es"], ["56", "es"], ["51", "es"],
].sort((a, b) => b[0].length - a[0].length) as [string, GuestLang][];

export interface GuestLangInput { language?: string | null; lang?: string | null; country?: string | null; phone?: string | null }

export function guestLangOf(g?: GuestLangInput | null): GuestLang {
  const explicit = String(g?.language || g?.lang || "").slice(0, 2).toLowerCase();
  if ((SUPPORTED as string[]).includes(explicit)) return explicit as GuestLang;

  const c = String(g?.country ?? "").trim().toUpperCase();
  if (c) return COUNTRY_LANG[c] ?? "en";

  const raw = String(g?.phone ?? "").trim();
  if (raw) {
    const international = raw.startsWith("+") || raw.startsWith("00");
    const digits = raw.replace(/\D/g, "").replace(/^00/, "");
    if (international) {
      const hit = PHONE_LANG.find(([p]) => digits.startsWith(p));
      return hit ? hit[1] : "en";
    }
  }
  return "it";
}
