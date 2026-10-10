// Modello tariffe a più piani e per numero di ospiti — SPENTO di default.
// Oggi Xenora invia a Channex UNA sola tariffa per tipologia/notte (un rate plan, occupazione di default).
// Booking ed Expedia supportano più piani per camera (non rimborsabile, con colazione, …) e prezzi per
// occupazione (es. 1 ospite). Questo modulo contiene SOLO la logica pura (nessuna rete, nessuno storage):
//  - la configurazione (chiave "spigolestay:ratemodel", letta dal blob come il pool di inventory-pool.ts);
//  - il calcolo del prezzo di un piano e del prezzo per 1 ospite;
//  - la costruzione delle righe ARI extra e del corpo per creare il rate plan su Channex.
// Con `enabled: false` (default) nulla cambia: buildAriPayload emette esattamente le righe di prima.

export const RATEMODEL_KEY = "spigolestay:ratemodel";

/** Sconto per 1 ospite (single occupancy): percentuale oppure importo fisso in € rispetto alla tariffa del piano. */
export interface SingleDiscount { mode: "pct" | "eur"; value: number }

/** Un piano tariffario in più per una tipologia (il piano "base" resta quello già mappato in ratePlanId). */
export interface RatePlanDef {
  id: string;        // id interno Xenora del piano (stabile; lega la definizione alla mappa Channex)
  name: string;      // es. "Non rimborsabile", "Con colazione"
  adjPct?: number;   // variazione % rispetto alla tariffa base del giorno (es. -10 = −10%)
  adjEur?: number;   // supplemento/sconto fisso in € (si somma dopo la %; es. +8 colazione)
  minStay?: number;  // restrizione diversa: soggiorno minimo del piano (si applica se maggiore di quello della tipologia)
}

export interface RateModelConfig {
  enabled: boolean;
  plans: Record<string, RatePlanDef[]>;       // xenoraRoomTypeId → piani in più
  single: Record<string, SingleDiscount>;     // xenoraRoomTypeId → sconto per 1 ospite
}

export const RATEMODEL_DEF: RateModelConfig = { enabled: false, plans: {}, single: {} };

const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);

/** Legge e ripulisce la configurazione. Qualunque anomalia → spento. */
export function parseRateModel(raw: string | null | undefined): RateModelConfig {
  try {
    const p = raw ? JSON.parse(raw) : null;
    if (!p || typeof p !== "object") return { enabled: false, plans: {}, single: {} };
    const plans: Record<string, RatePlanDef[]> = {};
    if (p.plans && typeof p.plans === "object") {
      for (const [rtId, list] of Object.entries(p.plans as Record<string, unknown>)) {
        if (!rtId || !Array.isArray(list)) continue;
        const ok: RatePlanDef[] = [];
        for (const it of list as Record<string, unknown>[]) {
          if (!it || typeof it.id !== "string" || !it.id) continue;
          const minStay = num(it.minStay);
          ok.push({
            id: it.id,
            name: typeof it.name === "string" ? it.name : "",
            adjPct: num(it.adjPct),
            adjEur: num(it.adjEur),
            minStay: minStay !== undefined && minStay > 1 ? Math.floor(minStay) : undefined,
          });
        }
        if (ok.length) plans[rtId] = ok;
      }
    }
    const single: Record<string, SingleDiscount> = {};
    if (p.single && typeof p.single === "object") {
      for (const [rtId, d] of Object.entries(p.single as Record<string, { mode?: unknown; value?: unknown }>)) {
        const value = num(d?.value);
        if (!rtId || value === undefined || value <= 0) continue;
        single[rtId] = { mode: d.mode === "eur" ? "eur" : "pct", value };
      }
    }
    return { enabled: p.enabled === true, plans, single };
  } catch { return { enabled: false, plans: {}, single: {} }; }
}

/** Funzione attiva davvero? (interruttore acceso e almeno un piano o sconto definito) */
export const rateModelActive = (cfg: RateModelConfig | undefined): cfg is RateModelConfig =>
  !!cfg?.enabled && (Object.keys(cfg.plans).length > 0 || Object.keys(cfg.single).length > 0);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Prezzo di un piano partendo dalla tariffa base del giorno: base × (1 + %/100) + €, mai negativo, 2 decimali. */
export function planRate(baseRate: number, plan: Pick<RatePlanDef, "adjPct" | "adjEur">): number {
  return Math.max(0, round2(baseRate * (1 + (plan.adjPct ?? 0) / 100) + (plan.adjEur ?? 0)));
}

/** Prezzo per 1 ospite partendo dal prezzo del piano (a occupazione standard): −% oppure −€, mai negativo. */
export function singleOccupancyRate(rate: number, d: SingleDiscount | undefined): number {
  if (!d || !(d.value > 0)) return rate;
  return Math.max(0, round2(d.mode === "eur" ? rate - d.value : rate * (1 - d.value / 100)));
}

/** Prezzi per occupazione di un piano: { 1: prezzo 1 ospite, [standard]: prezzo del piano }. Senza sconto → solo l'occupazione standard. */
export function occupancyRates(rate: number, d: SingleDiscount | undefined, standardOccupancy: number): { occupancy: number; rate: number }[] {
  const std = Math.max(1, Math.floor(standardOccupancy));
  const out: { occupancy: number; rate: number }[] = [];
  if (d && std > 1) out.push({ occupancy: 1, rate: singleOccupancyRate(rate, d) });
  out.push({ occupancy: std, rate });
  return out;
}

/** Piano extra mappato su Channex (estensione retrocompatibile di ChxStructMap.rooms[x]). */
export interface MappedExtraPlan {
  id: string;            // = RatePlanDef.id
  ratePlanId: string;    // id del rate plan su Channex
  perPerson?: boolean;   // il piano su Channex è "per persona": accetta i prezzi per occupazione
  occupancy?: number;    // occupazione standard (primaria) del piano; default 2
}

type RowLike = {
  property_id: string; rate_plan_id: string; date?: string; rate?: string; min_stay_arrival?: number;
  stop_sell?: boolean; closed_to_arrival?: boolean; closed_to_departure?: boolean;
  rates?: { occupancy: number; rate: string }[];
};

/**
 * Riga ARI di un piano extra, copiata dalla riga base del giorno (stesse chiusure/stop-sell/CTA/CTD)
 * con prezzo del piano, eventuale minimo soggiorno più alto e — se il piano è per persona e c'è uno
 * sconto — i prezzi per 1 ospite. `baseRow.rate` è la tariffa base già calcolata (stringa "xxx.xx").
 */
export function extraPlanRow<T extends RowLike>(
  baseRow: T, mapped: MappedExtraPlan, plan: RatePlanDef, single: SingleDiscount | undefined, baseMinStay: number,
): T {
  const baseRate = Number(baseRow.rate ?? 0);
  const rate = planRate(baseRate, plan);
  const row: T = { ...baseRow, rate_plan_id: mapped.ratePlanId, rate: rate.toFixed(2) };
  const ms = Math.max(baseMinStay, plan.minStay ?? 0);
  if (ms > 1) row.min_stay_arrival = ms; else delete row.min_stay_arrival;
  if (mapped.perPerson && single) {
    const occ = occupancyRates(rate, single, mapped.occupancy ?? 2).filter((o) => o.occupancy !== Math.max(1, Math.floor(mapped.occupancy ?? 2)));
    if (occ.length) row.rates = occ.map((o) => ({ occupancy: o.occupancy, rate: o.rate.toFixed(2) }));
  }
  return row;
}

/**
 * Corpo della richiesta POST /rate_plans per creare un piano extra su Channex (NON invocato da nessuna parte:
 * serve alla futura creazione guidata). Senza sconto 1 ospite è per camera come il piano base; con sconto è per persona.
 */
export function ratePlanCreateBody(
  propertyId: string, roomTypeId: string,
  o: { title: string; baseRate: number; plan: Pick<RatePlanDef, "adjPct" | "adjEur">; single?: SingleDiscount; occupancy: number; currency?: string },
) {
  const std = Math.max(1, Math.floor(o.occupancy));
  const rate = planRate(o.baseRate, o.plan);
  const perPerson = !!o.single && std > 1;
  const options = perPerson
    ? occupancyRates(rate, o.single, std).map((x) => ({ occupancy: x.occupancy, is_primary: x.occupancy === std, rate: Math.round(x.rate) }))
    : [{ occupancy: std, is_primary: true, rate: Math.round(rate) }];
  return {
    rate_plan: {
      title: o.title,
      property_id: propertyId,
      room_type_id: roomTypeId,
      currency: o.currency || "EUR",
      sell_mode: perPerson ? "per_person" : "per_room",
      rate_mode: "manual",
      options,
    },
  };
}
