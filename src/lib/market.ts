// Segnali di mercato CONDIVISI da Nèttare, Revenue e Revenue Autopilot.
// UNA fonte sola, onesta:
//   • "dati tuoi"  = occupazione/ADR REALI dell'utente, calcolati dalle prenotazioni nel blob;
//   • "media di zona" = benchmark anonimo della Rete città (Supabase RPC market_pulse),
//     usato SOLO quando la rete ha abbastanza strutture (dati reali). Se non è ancora
//     disponibile NON si inventano numeri: i suggerimenti restano basati sulla tua
//     occupazione reale e il gancio di zona resta pronto (hasZoneData = false).
//
// Prima di questo file ogni pagina rifaceva la propria query/formula: Nèttare usava il
// pulse cittadino, mentre Revenue e Autopilot ignoravano del tutto il mercato. Ora tutte
// e tre passano da qui per fonte dati e curva domanda→prezzo.

import type { Booking } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { shiftISO, toISO } from "./dates";

// Numero minimo di strutture perché la media di città sia significativa (coincide con la pagina Mercato).
export const MARKET_THRESHOLD = 3;
export const MARKET_WINDOW = 90;

/** Aggregato anonimo della città restituito dalla RPC `market_pulse`. */
export type MarketPulse = { n_structures: number; occupancy: number | null; adr: number | null; revpar?: number | null };

/**
 * Segnale di mercato normalizzato per il motore prezzi.
 * Compatibile per struttura con il tipo `Market` usato da Nèttare (cityHot + adrGap).
 */
export type MarketSignal = {
  hasZoneData: boolean;   // true SOLO se la Rete città ha dati reali sufficienti (≥ soglia strutture)
  cityOcc: number | null; // occupazione media di zona 0..1 (null = non disponibile)
  cityAdr: number | null; // ADR medio di zona € (null = non disponibile)
  cityHot: boolean;       // la zona è più piena di te → alza
  adrGap: number;         // (ADR zona − tuo ADR)/tuo ADR: > 0 = sei sotto la zona
};

export const EMPTY_SIGNAL: MarketSignal = { hasZoneData: false, cityOcc: null, cityAdr: null, cityHot: false, adrGap: 0 };

/** Normalizza il risultato grezzo della RPC (array o oggetto) in un MarketPulse coerente. */
export function normalizePulse(raw: unknown): MarketPulse | null {
  const p = Array.isArray(raw) ? raw[0] : raw;
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const num = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
  return { n_structures: Number(o.n_structures) || 0, occupancy: num(o.occupancy), adr: num(o.adr), revpar: num(o.revpar) };
}

/**
 * Recupera l'aggregato anonimo della città. UNICA implementazione della query,
 * riusata da Nèttare / Revenue / Mercato. Se Supabase o la città mancano, o la RPC
 * non è ancora provisionata sul DB, torna null senza rompere nulla (modalità solo-locale).
 */
export async function fetchCityPulse(sb: SupabaseClient | null, city: string, windowDays = MARKET_WINDOW): Promise<MarketPulse | null> {
  if (!sb || !city) return null;
  const to = toISO(new Date());
  const from = shiftISO(to, -windowDays);
  try {
    const { data } = await sb.rpc("market_pulse", { p_city: city, p_from: from, p_to: to });
    return normalizePulse(data);
  } catch { return null; }
}

/** true se la Rete città ha dati REALI e sufficienti (≥ soglia strutture). */
export const zoneDataReady = (p: MarketPulse | null): boolean => !!p && p.n_structures >= MARKET_THRESHOLD;

/** Costruisce il segnale di mercato dai TUOI dati reali + zona (solo se pronta). */
export function computeMarketSignal(myOcc: number, myAdr: number, pulse: MarketPulse | null): MarketSignal {
  if (!zoneDataReady(pulse) || !pulse) return EMPTY_SIGNAL;
  const cityOcc = pulse.occupancy, cityAdr = pulse.adr;
  return {
    hasZoneData: true,
    cityOcc,
    cityAdr,
    cityHot: cityOcc != null && cityOcc > myOcc + 0.05,
    adrGap: cityAdr != null && myAdr > 0 ? (cityAdr - myAdr) / myAdr : 0,
  };
}

/** Occupazione REALE on-the-books della struttura in un giorno (0..1), dalle prenotazioni nel blob. */
export function ownOccupancy(bookings: Booking[], unitCount: number, structureId: string, iso: string): number {
  if (unitCount <= 0) return 0;
  const sold = bookings.filter(
    (b) =>
      b.status !== "cancelled" &&
      b.channel !== "blocked" &&
      (structureId === "all" || b.structureId === structureId) &&
      b.checkIn <= iso &&
      b.checkOut > iso,
  ).length;
  return sold / unitCount;
}

/**
 * Contributo di zona (Rete città) al moltiplicatore prezzo. Attivo SOLO con dati reali
 * di zona; altrimenti moltiplicatore neutro (1) e nessuna motivazione. Condiviso da
 * Revenue e Autopilot così la logica di zona è identica ovunque.
 */
export function zoneMultiplier(signal: MarketSignal | undefined, occ: number): { mult: number; reasons: string[] } {
  const reasons: string[] = [];
  let mult = 1;
  if (!signal?.hasZoneData) return { mult, reasons };
  if (signal.cityHot && occ >= 0.25) { mult *= 1.06; reasons.push("Zona molto piena (Rete città)"); }
  if (signal.adrGap > 0.05) { mult *= 1 + Math.min(signal.adrGap, 0.15); reasons.push(`Sotto l'ADR di zona (+${Math.round(signal.adrGap * 100)}%)`); }
  else if (signal.adrGap < -0.08) { mult *= 0.97; reasons.push("Sopra l'ADR di zona"); }
  return { mult, reasons };
}

/**
 * Curva domanda→moltiplicatore CONDIVISA. Combina la TUA occupazione reale con gli eventi
 * e il segnale di zona (se disponibile). Torna il moltiplicatore sul prezzo base e il "perché".
 */
export function demandMultiplier(occ: number, opts: { hasEvent?: boolean; signal?: MarketSignal; lastMinute?: boolean } = {}): { mult: number; reasons: string[] } {
  const { hasEvent = false, signal, lastMinute = false } = opts;
  let mult = 1;
  const reasons: string[] = [];
  const occPct = Math.round(occ * 100);
  if (occ >= 0.85) { mult *= 1.22; reasons.push(`Tua occupazione ${occPct}%: molto alta`); }
  else if (occ >= 0.65) { mult *= 1.1; reasons.push(`Tua occupazione ${occPct}%: alta`); }
  else if (occ >= 0.35) { reasons.push(`Tua occupazione ${occPct}%: nella norma`); }
  else { mult *= 0.9; reasons.push(`Tua occupazione ${occPct}%: bassa, riempi`); }
  if (hasEvent) { mult *= 1.08; reasons.push("Evento in città"); }
  if (lastMinute && occ < 0.5) { mult *= 0.95; reasons.push("Last-minute ancora scarico"); }
  const z = zoneMultiplier(signal, occ);
  mult *= z.mult;
  reasons.push(...z.reasons);
  return { mult, reasons };
}

/** Suggerimento discreto per la pagina Revenue (pct/etichetta/colore) derivato dalla curva condivisa. */
export function revenueSuggestion(occ: number, hasEvent: boolean, signal: MarketSignal = EMPTY_SIGNAL): { pct: number; label: string; color: string; reasons: string[] } {
  const { mult, reasons } = demandMultiplier(occ, { hasEvent, signal });
  const pct = Math.round((mult - 1) * 100);
  let label: string, color: string;
  if (pct >= 15) { label = "Alza forte"; color = "var(--err)"; }
  else if (pct >= 5) { label = "Alza"; color = "#D97706"; }
  else if (pct <= -5) { label = "Abbassa"; color = "#2563EB"; }
  else { label = "Mantieni"; color = "var(--ok)"; }
  return { pct, label, color, reasons };
}
