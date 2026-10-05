// Colore personalizzato di una prenotazione nel calendario. Se manca si usa quello del canale (default invariato).
export const BOOKING_COLORS = ["#2563eb", "#0e9f6e", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#0891b2", "#4b5563"];

export const isHexColor = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c.trim());

/** Testo leggibile sopra lo sfondo scelto: bianco su colori scuri, quasi nero su colori chiari. */
export function textOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#1a1a1a" : "#ffffff";
}
