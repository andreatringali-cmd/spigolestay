// Richieste REALI dell'ospite: dalle note di una prenotazione OTA si tolgono le righe tecniche del portale (commissione, importo da addebitare, pagamento, preferenze
// fumatori/letti, piano pasto, fonte…), che non sono richieste dell'ospite. Resta solo ciò che l'ospite ha scritto. Serve alle schede delle Pulizie.

// Inizi di riga («etichetta: valore») scritti dai portali nelle note, in minuscolo.
const OTA_LABELS = [
  "accelerator fee", "collect amount", "ota commission", "payment collect", "payment instruction", "payment type", "payment charge", "payment method",
  "smoking preference", "smoking preferences", "bed preference", "bed preferences", "meal plan", "source", "booking note", "total paid amount", "total amount",
  "listing base price", "listing cleaning fee", "listing basic", "transient occupancy tax", "occupancy tax amount", "currency", "rate plan", "room type", "promotion", "discount",
];

const isTechnical = (line: string): boolean => {
  const t = line.trim().toLowerCase();
  if (!t) return true;
  if (t.startsWith("**") && t.endsWith("**")) return true;            // «** THIS RESERVATION HAS BEEN PRE-PAID **»
  return OTA_LABELS.some((l) => t.startsWith(`${l}:`) || t.startsWith(`${l} :`) || t === l);
};

/** Testo delle richieste scritte dall'ospite, oppure undefined se nelle note c'è solo roba tecnica del portale. */
export function realGuestRequests(notes: string | null | undefined): string | undefined {
  if (typeof notes !== "string") return undefined;
  const kept = notes.split(/\r?\n/).filter((l) => !isTechnical(l)).map((l) => l.trim()).join("\n").trim();
  return kept || undefined;
}
