// OTA → canale Xenora (puro, senza dipendenze: lo usano l'import in entrata, le route e la riconciliazione).
export function channelFromOta(ota?: string): string {
  const s = (ota || "").toLowerCase();
  if (!s) return "direct";
  if (s.includes("book")) return "booking";
  if (s.includes("airbnb")) return "airbnb";
  if (s.includes("expedia") || s.includes("vrbo") || s.includes("homeaway")) return "expedia";
  if (s.includes("hotelbed") || s.includes("hotel bed") || s.includes("hbeds")) return "hotelbeds";
  if (s.includes("agoda")) return "agoda";
  if (s.includes("google")) return "google"; // Google Hotel Search (link gratuiti di prenotazione) via Channex
  if (s.includes("direct") || s.includes("crs") || s.includes("website")) return "direct";
  return "other";
}
