// OTA → canale Xenora (puro: lo usano l'import in entrata, le route e la riconciliazione; l'unica dipendenza è il catalogo OTA, anch'esso puro).
import { OTA_CATALOG } from "./ota-catalog";

/** Nome senza spazi, punti, trattini bassi e trattini, in minuscolo: "Booking.com" → "bookingcom", "Vertical_Booking" → "verticalbooking". */
const squash = (v: string): string => v.toLowerCase().replace(/[\s._-]+/g, "");

// Portali del catalogo che hanno un canale proprio in Xenora: tutti gli ALTRI nomi del catalogo (123booking, Bookingfor, BookOn, Simplebooking,
// Webbooking, NeoBooking, Sharebooking, Vertical_Booking, BookingExpert, hotelsdirects, ...) sono "altro / OTA" e non devono finire su Booking.com
// solo perché contengono "book".
const MAIN_KEYS = new Set(["booking", "airbnb", "expedia", "vrbo", "agoda", "google"]);
const KNOWN_OTHER: Set<string> = (() => {
  const set = new Set<string>();
  for (const o of OTA_CATALOG) {
    if (o.category !== "OTA" || MAIN_KEYS.has(o.key)) continue;
    const label = o.label.replace(/\([^)]*\)/g, " "); // toglie "(only availability)", "(Netstorming)"
    set.add(squash(label));
    for (const part of label.split(/\s+[-/]\s+/)) if (part.trim()) set.add(squash(part)); // "hotelsdirects - Koedia (HDA)" → "hotelsdirects"
  }
  return set;
})();

export function channelFromOta(ota?: string): string {
  const raw = (ota || "").trim();
  if (!raw) return "direct";
  const s = raw.toLowerCase();
  const k = squash(raw);
  if (KNOWN_OTHER.has(k)) return "other"; // portale noto del catalogo senza canale proprio: prima di ogni controllo "contiene"
  // Booking.com: solo il nome esatto ("Booking", "Booking.com", "BookingCom"), mai ogni nome che contiene "book".
  if (k === "booking" || k.startsWith("bookingcom")) return "booking";
  if (k.includes("airbnb")) return "airbnb";
  if (k.includes("expedia") || k.includes("vrbo") || k.includes("homeaway")) return "expedia";
  if (k.includes("hotelbed") || k.includes("hbeds")) return "hotelbeds";
  if (k.includes("agoda")) return "agoda";
  if (k.includes("google")) return "google"; // Google Hotel Search (link gratuiti di prenotazione) via Channex
  // Diretta: parola intera (non "hotelsdirects"), DOPO le OTA note: "Direct Booking" e "Website booking engine" sono diretta.
  if (/\b(direct|crs|website)\b/.test(s.replace(/[._-]+/g, " "))) return "direct";
  return "other";
}
