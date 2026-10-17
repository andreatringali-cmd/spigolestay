// Riconoscimento del portale dal NOME del canale su Channex (quando il codice OTA è generico, "Altro / OTA"). Funzione pura (testabile).

// Solo il portale bed-and-breakfast.it ("bb.it", "bed-and-breakfast.it", "bbit"): NON basta "B&B" generico
// (es. "B&B Hotels" è una catena alberghiera, e molte OTA hanno "B&B" nel nome della categoria).
const BBIT_RE = /(?:^|[^a-z0-9])bb\.it(?![a-z0-9])|(?:^|[^a-z0-9])bbit(?![a-z0-9])|bed\s*(?:&|and|-and-|n)?\s*-?\s*breakfast\s*\.\s*it(?![a-z0-9])|(?:^|[^a-z0-9])b\s*&\s*b\s*\.\s*it(?![a-z0-9])/i;

export function isBedAndBreakfastIt(name?: string): boolean {
  const n = name ?? "";
  if (/b\s*&\s*b\s*hotels?/i.test(n)) return false;
  if (BBIT_RE.test(n)) return true;
  // Channex manda il nome del portale senza punti/spazi ("BedAndBreakfast", "Bed and Breakfast", "Bed & Breakfast Italia"):
  // confronto sul nome "schiacciato" (solo lettere/cifre/punti). Restano esclusi "B&B Hotels" e i domini .com/.eu/.nl.
  // Su Channex il canale si chiama "<portale> - <struttura>" ("BedAndBreakfastItaly - Central Perk - Antioco"): conta solo il portale, prima del primo " - ".
  const sq = shortChannelTitle(n).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return sq === "bedandbreakfast" || sq === "bedandbreakfastit" || sq === "bedbreakfastit" || sq === "bedandbreakfastitalia" || sq === "bedbreakfastitalia" || sq === "bedandbreakfastitaly" || sq === "bedbreakfastitaly";
}

/** Nome breve di un canale: Channex lo chiama "<portale> - <struttura>"; si tiene solo il portale (la struttura si sa già dal selettore in alto). */
export function shortChannelTitle(title: string | null | undefined): string {
  const t = String(title ?? "").trim();
  const head = t.split(/\s+[-–—]\s+/)[0].trim();
  return head || t;
}

/** Etichetta usata quando il gruppo "Altro" raccoglie più portali diversi (nessun logo/nome del primo). */
export const MIXED_OTA_LABEL = "Altre OTA";

/**
 * Nome del portale per l'aggregato "Altro / OTA": è il nome comune SOLO se TUTTE le prenotazioni del gruppo hanno lo stesso otaName
 * (confronto senza maiuscole/spazi); se i nomi sono diversi, o alcune prenotazioni non ne hanno uno, il gruppo è "misto"
 * e non va mostrato il logo/nome del primo portale trovato.
 */
export function otaGroupName(names: Iterable<string | null | undefined>): { name?: string; mixed: boolean } {
  let first: string | undefined;
  let key: string | null = null;
  let mixed = false;
  let any = false;
  for (const raw of names) {
    any = true;
    const n = (raw ?? "").trim();
    const k = n.toLowerCase();
    if (key === null) { key = k; first = n || undefined; continue; }
    if (k !== key) { mixed = true; break; }
  }
  if (!any || mixed) return { name: undefined, mixed };
  return { name: first, mixed: false };
}
