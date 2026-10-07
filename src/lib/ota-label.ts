// Nome della OTA da mostrare accanto a un messaggio o su un pulsante (client e server: nessuna dipendenza).
export function otaLabel(channel?: string): string {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("booking")) return "Booking.com";
  if (c.includes("airbnb")) return "Airbnb";
  if (c.includes("expedia") || c.includes("vrbo")) return "Expedia";
  return "OTA";
}

/** Il testo `via` di un messaggio indica che arriva da una OTA (e non da WhatsApp o email)? */
export const isOtaVia = (via?: string): boolean => ["Booking.com", "Airbnb", "Expedia", "OTA"].includes(via ?? "");
