// Nomi di persona mostrati nell'app: dalle OTA arrivano spesso tutti in MAIUSCOLO ("MICHIEL VAN HERTEN").
// Si mostra la sola iniziale di ogni parola maiuscola ("Michiel Van Herten"); i dati salvati non cambiano.

/** "PAPOUTSAKIS IOANNIS" → "Papoutsakis Ioannis"; gestisce apostrofi e trattini ("D'ANGELO" → "D'Angelo", "JEAN-PIERRE" → "Jean-Pierre"). */
export function titleCaseName(name: string | null | undefined): string {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase());
}
