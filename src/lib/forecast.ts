// Previsione storica di occupazione — FASE 1 del "motore predittivo" Xenora.
//
// Cos'è, onestamente: una media pesata dello storico reale (stesso giorno della
// settimana, ultime N settimane, più peso ai dati recenti) più, come piccolo
// correttivo, il livello medio della Rete città quando è disponibile e reale
// (vedi lib/market.ts → fetchCityPulse/zoneDataReady). NON è machine learning,
// NON è "intelligenza artificiale": è un metodo statistico semplice e verificabile,
// nello stesso spirito di onestà sui dati di lib/market.ts e lib/autopilot-explain.ts.
// Va chiamata per quello che è nella UI ("Previsione basata sullo storico"), mai
// spacciata per IA.
//
// Perché esiste come modulo separato: lib/market.ts calcola il segnale di mercato
// ISTANTANEO (occupazione di oggi + zona di oggi) usato per il moltiplicatore prezzo
// attuale — quella logica è già validata e non va toccata. Questo file aggiunge un
// livello DIVERSO e opzionale: una stima per un giorno FUTURO basata sull'andamento
// storico, pensata come segnale informativo in più (es. nel "Perché" di Revenue
// Autopilot), mai come input che altera silenziosamente i moltiplicatori esistenti.
//
// Come cresce con la Rete Xenora: la stima usa già oggi `MarketPulse` (via
// zoneDataReady/pulseHasDemo, stessa fonte di lib/market.ts — nessuna query duplicata)
// come correttivo quando lo storico proprio è scarso. Più strutture reali si uniscono
// alla Rete, più `pulse.occupancy` diventa un'ancora affidabile, e questa stessa
// funzione diventa più precisa senza bisogno di riscrivere l'architettura.
import type { Booking } from "./types";
import { shiftISO, parseISO } from "./dates";
import { ownOccupancy, zoneDataReady, pulseHasDemo, type MarketPulse } from "./market";

// Quante settimane indietro guardare per lo stesso giorno della settimana del target.
// 12 settimane ≈ 3 mesi: abbastanza per catturare stagionalità settimanale senza
// scavare in uno storico troppo vecchio (e quindi meno rilevante) per un B&B.
export const FORECAST_LOOKBACK_WEEKS = 12;

// Decadimento esponenziale: ogni FORECAST_DECAY_HALFLIFE_WEEKS settimane più indietro,
// il peso del campione si dimezza. I dati recenti contano di più di quelli vecchi.
export const FORECAST_DECAY_HALFLIFE_WEEKS = 5;

// Soglie sul NUMERO DI SETTIMANE REALI (proprie) disponibili per quel giorno della
// settimana: sotto la soglia minima non si mostra nessun numero (mai inventare una
// previsione precisa su troppo poco storico, stesso principio di zoneDataReady).
export const FORECAST_MIN_WEEKS_LOW = 3;    // sotto: "insufficiente" → nessuna previsione mostrata
export const FORECAST_MIN_WEEKS_MEDIUM = 6; // sopra: confidenza "media"
export const FORECAST_MIN_WEEKS_HIGH = 10;  // sopra: confidenza "alta"

// Peso massimo che il livello medio di zona (Rete città) può avere sulla stima finale,
// e solo come correttivo prudente quando lo storico proprio è ancora scarso.
export const FORECAST_NETWORK_MAX_WEIGHT = 0.25;

export type ForecastConfidence = "insufficiente" | "bassa" | "media" | "alta";

export interface HistoricalForecast {
  iso: string;
  occPct: number | null;        // stima 0..100, null se sotto soglia minima (mai un numero finto)
  confidence: ForecastConfidence;
  sampleWeeks: number;          // quante settimane di storico REALE proprio hanno contribuito
  usedNetwork: boolean;         // true se il livello di zona (Rete città) ha corretto la stima
  networkHasDemo: boolean;      // true se il contributo di rete include strutture demo dimostrative
  label: string | null;         // frase pronta per la UI, null quando non c'è nulla di onesto da dire
}

const CONFIDENCE_WORD: Record<ForecastConfidence, string> = {
  insufficiente: "insufficiente",
  bassa: "bassa",
  media: "media",
  alta: "alta",
};

const WEEKDAY_LONG = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
function dayLabel(iso: string): string {
  const d = parseISO(iso);
  return `${WEEKDAY_LONG[d.getDay()]} ${d.getDate()}`;
}

/**
 * Stima l'occupazione di un giorno FUTURO (o passato, per test) guardando lo stesso
 * giorno della settimana nelle ultime FORECAST_LOOKBACK_WEEKS settimane, con peso
 * decrescente più si va indietro nel tempo. Usa `ownOccupancy` (lib/market.ts) così
 * la definizione di "occupazione" resta identica ovunque nel prodotto.
 *
 * Se lo storico proprio è scarso e la Rete città ha un pulse reale/sufficiente
 * (zoneDataReady), lo shrinka leggermente verso il livello medio di zona: più lo
 * storico è povero, più il correttivo di zona pesa (fino a FORECAST_NETWORK_MAX_WEIGHT).
 * Non tocca mai `demandMultiplier`/`zoneMultiplier`: è un segnale a parte.
 */
export function forecastOccupancy(
  bookings: Booking[],
  unitCount: number,
  structureId: string,
  targetISO: string,
  todayISO: string,
  pulse: MarketPulse | null = null,
): HistoricalForecast {
  const empty = (sampleWeeks: number): HistoricalForecast => ({
    iso: targetISO, occPct: null, confidence: "insufficiente", sampleWeeks, usedNetwork: false, networkHasDemo: false, label: null,
  });
  if (unitCount <= 0) return empty(0);

  // Solo giorni già accaduti possono essere "storico reale": mai simulare dati futuri.
  const samples: { occ: number; weeksAgo: number }[] = [];
  for (let w = 1; w <= FORECAST_LOOKBACK_WEEKS; w++) {
    const sampleISO = shiftISO(targetISO, -7 * w);
    if (sampleISO > todayISO) continue;
    samples.push({ occ: ownOccupancy(bookings, unitCount, structureId, sampleISO), weeksAgo: w });
  }
  const sampleWeeks = samples.length;
  if (sampleWeeks < FORECAST_MIN_WEEKS_LOW) return empty(sampleWeeks);

  let totalWeight = 0, weighted = 0;
  for (const s of samples) {
    const w = Math.pow(0.5, s.weeksAgo / FORECAST_DECAY_HALFLIFE_WEEKS);
    totalWeight += w; weighted += w * s.occ;
  }
  const ownEstimate = totalWeight > 0 ? weighted / totalWeight : 0;

  let estimate = ownEstimate;
  let usedNetwork = false;
  let networkHasDemo = false;
  if (pulse && zoneDataReady(pulse) && pulse.occupancy != null && sampleWeeks < FORECAST_MIN_WEEKS_HIGH) {
    // Più lo storico proprio è scarso, più il livello medio di zona pesa come ancora prudente.
    const netWeight = FORECAST_NETWORK_MAX_WEIGHT * (1 - sampleWeeks / FORECAST_MIN_WEEKS_HIGH);
    if (netWeight > 0.01) {
      estimate = ownEstimate * (1 - netWeight) + pulse.occupancy * netWeight;
      usedNetwork = true;
      networkHasDemo = pulseHasDemo(pulse);
    }
  }
  estimate = Math.min(1, Math.max(0, estimate));
  const occPct = Math.round(estimate * 100);

  const confidence: ForecastConfidence =
    sampleWeeks >= FORECAST_MIN_WEEKS_HIGH ? "alta" : sampleWeeks >= FORECAST_MIN_WEEKS_MEDIUM ? "media" : "bassa";

  const weekWord = sampleWeeks === 1 ? "settimana" : "settimane";
  const networkClause = usedNetwork ? " + media di zona" : "";
  const demoMark = networkHasDemo ? " *" : "";
  const label = `Previsione storica: ${dayLabel(targetISO)} probabilmente al ${occPct}% (confidenza ${CONFIDENCE_WORD[confidence]}, basata su ${sampleWeeks} ${weekWord} di storico proprio${networkClause})${demoMark}`;

  return { iso: targetISO, occPct, confidence, sampleWeeks, usedNetwork, networkHasDemo, label };
}

/** Le date ISO del prossimo weekend (sabato e domenica) a partire da oggi incluso. */
export function nextWeekendISOs(todayISO: string): [string, string] {
  const dow = parseISO(todayISO).getDay(); // 0=domenica..6=sabato
  const daysToSaturday = (6 - dow + 7) % 7;
  const saturday = shiftISO(todayISO, daysToSaturday);
  return [saturday, shiftISO(saturday, 1)];
}

/** Nota a piè di pagina da mostrare quando almeno una previsione include dati di rete demo. */
export const FORECAST_DEMO_NOTE = "* la correzione di zona usata in questa previsione include, per ora, anche strutture demo dimostrative";
