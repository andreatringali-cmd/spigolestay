// Allerta "prezzo sotto costo": confronta il prezzo di una prenotazione con la tariffa attesa
// (calcolata dal motore prezzi di Xenora, src/lib/pricing.ts) e segnala quando è insolitamente
// più basso. Serve a intercettare subito anomalie di prezzo lato canale (es. una promo attiva
// sul canale OTA, tipo Booking.com "Late Escape Deal", eventualmente sommata al programma Genius)
// invece di scoprirle per caso a distanza di tempo.
//
// Solo rilevamento: non tocca mai il prezzo della prenotazione, si limita a segnalarla.
import type { Booking, Channel, RoomType } from "./types";
import { addDays, nights, parseISO, toISO } from "./dates";
import { rateForDay } from "./pricing";

// Sotto quale percentuale della tariffa attesa (a notte) una prenotazione si considera "sotto
// costo". Costante nominata per poterla ritoccare facilmente in futuro.
export const UNDERPRICE_THRESHOLD_PCT = 20;

// Sotto questa tariffa attesa (€/notte) non si segnala: su importi quasi nulli (tipologia con
// prezzo non configurato, override a pochi euro…) la % diventa rumore, non un'anomalia reale.
export const UNDERPRICE_MIN_EXPECTED_PER_NIGHT = 15;

// Canali OTA: soggetti a promozioni decise dal canale stesso (fuori dal controllo di Xenora), es.
// le offerte "Genius"/"Last minute" di Booking.com. Le prenotazioni dirette (channel "direct") NON
// si controllano qui: un eventuale sconto lì è sempre una promo approvata dal gestore stesso nel
// modulo Promozioni di Xenora (src/app/(app)/promozioni), applicata in fase di prenotazione sul
// sito — non un'anomalia da segnalare.
const CHANNELS_TO_CHECK: Channel[] = ["booking", "airbnb", "expedia", "hotelbeds", "other"];

export interface UnderpriceCheck {
  flagged: boolean;
  nights: number;
  expectedTotal: number;      // € attesi per l'intero soggiorno (somma rateForDay per notte)
  actualTotal: number;        // € soggiorno effettivamente registrato (b.total)
  expectedPerNight: number;
  actualPerNight: number;
  diffPct: number;            // di quanto l'effettivo è sotto l'atteso (0.30 = 30% sotto)
}

type BookingForCheck = Pick<Booking, "channel" | "status" | "roomTypeId" | "checkIn" | "checkOut" | "total">;

// Tariffa attesa per l'intero soggiorno: somma di rateForDay (stessa fonte usata da calendario,
// revenue e preventivi) per ogni notte, così segue automaticamente eventuali override di calendario
// e la maggiorazione weekend della struttura.
export function expectedStayTotal(b: Pick<Booking, "roomTypeId" | "checkIn" | "checkOut">, roomTypes: RoomType[], overrides: Record<string, number>, weekendPct: number): number {
  const n = nights(b.checkIn, b.checkOut);
  if (n <= 0) return 0;
  let total = 0;
  let d = parseISO(b.checkIn);
  for (let i = 0; i < n; i++) {
    total += rateForDay(b.roomTypeId, toISO(d), roomTypes, overrides, weekendPct);
    d = addDays(d, 1);
  }
  return total;
}

// Confronto GROSSO-vs-GROSSO: b.total (soggiorno fatturato all'ospite, prima della commissione OTA)
// contro la tariffa di listino attesa (anch'essa lorda, prima di qualunque commissione). Sono la
// stessa grandezza economica, quindi il confronto è corretto senza dover stimare la commissione;
// pulizia/extra/tassa di soggiorno restano fuori da entrambi i lati (non sono nella tariffa/notte).
export function checkUnderpriced(b: BookingForCheck, roomTypes: RoomType[], overrides: Record<string, number>, weekendPct: number): UnderpriceCheck | null {
  if (!CHANNELS_TO_CHECK.includes(b.channel)) return null;
  if (b.status === "cancelled" || b.status === "no_show") return null;
  const n = nights(b.checkIn, b.checkOut);
  if (n <= 0) return null;
  const actualTotal = b.total ?? 0;
  if (actualTotal <= 0) return null;
  const expectedTotal = expectedStayTotal(b, roomTypes, overrides, weekendPct);
  if (expectedTotal <= 0) return null;
  const expectedPerNight = expectedTotal / n;
  const actualPerNight = actualTotal / n;
  if (expectedPerNight < UNDERPRICE_MIN_EXPECTED_PER_NIGHT) return null;
  const diffPct = (expectedPerNight - actualPerNight) / expectedPerNight;
  return {
    flagged: diffPct > UNDERPRICE_THRESHOLD_PCT / 100,
    nights: n,
    expectedTotal,
    actualTotal,
    expectedPerNight,
    actualPerNight,
    diffPct,
  };
}

// Riga di spiegazione pronta per un title/tooltip: cifre + ipotesi più probabile.
export function underpriceReason(b: Pick<Booking, "channel">, chk: UnderpriceCheck): string {
  const pct = Math.round(chk.diffPct * 100);
  const chLabel = b.channel === "booking" ? "Booking.com" : b.channel === "airbnb" ? "Airbnb" : b.channel === "expedia" ? "Expedia/Vrbo" : b.channel === "hotelbeds" ? "HotelBeds" : "questo canale";
  return `Prezzo sotto costo: atteso ~€${Math.round(chk.expectedPerNight)}/notte, registrato €${Math.round(chk.actualPerNight)}/notte (−${pct}%). Prezzo insolitamente basso per il canale — controlla eventuali promozioni attive su ${chLabel} (es. offerte last minute o programma Genius).`;
}
