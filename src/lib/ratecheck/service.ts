// Servizio rate-shopping (server-side). Interfaccia connettore generica, pronta
// alla produzione e gated da variabili d'ambiente — stessa filosofia di Alloggiati Web.
//
// Se RATECHECK_API_URL e RATECHECK_API_KEY sono impostati, `fetchMarketRates`
// interroga un provider generico (POST JSON, Bearer auth) e NORMALIZZA la risposta
// nel formato { date, avg, min, max, sample }[]. Senza le env ritorna
// { configured:false } (niente dati finti). Nessun errore fa crashare il chiamante.

export interface Competitor {
  name: string;
  url?: string; // link all'annuncio OTA (Booking/Airbnb…)
  id?: string;  // eventuale id property presso il provider di rate shopping
}

export interface MarketRateRow {
  date: string;   // ISO "YYYY-MM-DD"
  avg: number;    // media di mercato (€)
  min: number;    // tariffa minima rilevata (€)
  max: number;    // tariffa massima rilevata (€)
  sample: number; // numero di strutture/competitor considerati
}

export interface FetchMarketRatesInput {
  lat?: number;
  lng?: number;
  competitors?: Competitor[];
  from: string; // ISO "YYYY-MM-DD" (incluso)
  to: string;   // ISO "YYYY-MM-DD" (esclusivo: primo giorno NON coperto)
}

export type FetchMarketRatesResult =
  | { configured: false }
  | { configured: true; rows: MarketRateRow[]; error?: string };

const RATECHECK_API_URL = process.env.RATECHECK_API_URL;
const RATECHECK_API_KEY = process.env.RATECHECK_API_KEY;

// True quando entrambe le env sono impostate: da qui in poi il confronto è REALE.
export function rateCheckConfigured(): boolean {
  return !!RATECHECK_API_URL && !!RATECHECK_API_KEY;
}

const numOr = (v: unknown, fallback = 0): number => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
};

const isoDay = (v: unknown): string => {
  if (typeof v === "string") return v.slice(0, 10);
  if (typeof v === "number") { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); }
  return "";
};

// Normalizza risposte eterogenee: accetta un array in radice, oppure { rows|data|rates|results: [...] }.
// Ogni riga può usare nomi diversi per gli stessi campi (date/day, avg/average/mean, ecc.).
function normalize(payload: unknown, fallbackSample: number): MarketRateRow[] {
  const arr: unknown[] = Array.isArray(payload)
    ? payload
    : (Array.isArray((payload as Record<string, unknown>)?.rows) ? (payload as { rows: unknown[] }).rows
      : Array.isArray((payload as Record<string, unknown>)?.data) ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as Record<string, unknown>)?.rates) ? (payload as { rates: unknown[] }).rates
      : Array.isArray((payload as Record<string, unknown>)?.results) ? (payload as { results: unknown[] }).results
      : []);

  const out: MarketRateRow[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const date = isoDay(pick(o, ["date", "day", "checkIn", "check_in", "ymd"]));
    if (!date) continue;
    const avgRaw = pick(o, ["avg", "average", "mean", "median", "rate", "price"]);
    let avg = numOr(avgRaw);
    let min = numOr(pick(o, ["min", "minimum", "low", "lowest"]), avg);
    let max = numOr(pick(o, ["max", "maximum", "high", "highest"]), avg);
    // Se manca la media ma ci sono min/max, ricavala; e viceversa mantieni la coerenza.
    if (!avg && (min || max)) avg = Math.round(((min || max) + (max || min)) / 2);
    if (!min) min = avg;
    if (!max) max = avg;
    if (min > max) { const s = min; min = max; max = s; }
    const sample = Math.max(0, Math.round(numOr(pick(o, ["sample", "count", "n", "properties", "competitors"]), fallbackSample)));
    out.push({ date, avg: Math.round(avg), min: Math.round(min), max: Math.round(max), sample });
  }
  // Ordina per data e deduplica (ultima vince).
  const byDate = new Map<string, MarketRateRow>();
  for (const r of out) byDate.set(r.date, r);
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchMarketRates(input: FetchMarketRatesInput): Promise<FetchMarketRatesResult> {
  if (!rateCheckConfigured()) return { configured: false };

  const competitors = input.competitors ?? [];
  const body = {
    from: input.from,
    to: input.to,
    lat: input.lat,
    lng: input.lng,
    // Passiamo i competitor sia con chiave estesa sia compatta per massima compatibilità provider.
    competitors: competitors.map((c) => ({ name: c.name, url: c.url, id: c.id })),
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(RATECHECK_API_URL!, {
      method: "POST",
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RATECHECK_API_KEY}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      return { configured: true, rows: [], error: `Provider rate shopping: HTTP ${r.status}` };
    }
    const json: unknown = await r.json().catch(() => null);
    if (json == null) return { configured: true, rows: [], error: "Risposta provider non leggibile (JSON non valido)." };
    return { configured: true, rows: normalize(json, competitors.length) };
  } catch (e) {
    const msg = (e as Error)?.name === "AbortError" ? "Timeout del provider rate shopping." : ((e as Error)?.message || "Errore di connessione al provider rate shopping.");
    return { configured: true, rows: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}
