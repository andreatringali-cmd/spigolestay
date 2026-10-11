// Stima della commissione OTA per le prenotazioni SENZA cifra reale.
// Le percentuali cambiano da canale a canale (e da struttura a struttura) in base a promo, programmi di visibilità e livelli Genius che attivi:
// un valore fisso per canale è quindi per forza approssimativo. Qui si stima dai dati veri: media PESATA (commissioni ÷ lordo) delle prenotazioni
// dello stesso canale e della stessa struttura con commissione reale, nell'ultimo anno. Modulo puro (niente rete): lo usano il calcolo delle
// commissioni, la pagina Canali e i test.

type B = { channel?: string; structureId?: string; status?: string; total?: number; commissionAmount?: number | null; checkIn: string };

/** Servono almeno tante prenotazioni con cifra reale, altrimenti la stima non è affidabile e si usa la percentuale standard. */
export const MIN_ESTIMATE_SAMPLES = 5;

const key = (channel: string, structureId?: string) => `${channel}@${structureId ?? ""}`;

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10);
}

/** Percentuale stimata per ogni "canale@struttura", un decimale. Canali senza commissione (diretta, blocchi) esclusi. */
export function computeCommissionEstimates(bookings: B[], todayIso: string): Record<string, number> {
  const from = isoMinusDays(todayIso, 365);
  const acc = new Map<string, { amt: number; tot: number; n: number }>();
  for (const b of bookings) {
    if (b.status === "cancelled" || !b.channel || b.channel === "direct" || b.channel === "blocked") continue;
    if (b.commissionAmount == null || !(b.total && b.total > 0) || !(b.commissionAmount >= 0)) continue;
    if (b.checkIn < from) continue;
    const k = key(b.channel, b.structureId);
    const a = acc.get(k) ?? { amt: 0, tot: 0, n: 0 };
    a.amt += b.commissionAmount; a.tot += b.total; a.n += 1; acc.set(k, a);
  }
  const out: Record<string, number> = {};
  acc.forEach((a, k) => { if (a.n >= MIN_ESTIMATE_SAMPLES && a.tot > 0) out[k] = Math.round((a.amt / a.tot) * 1000) / 10; });
  return out;
}

let ESTIMATES: Record<string, number> = {};
export function setCommissionEstimates(m: Record<string, number>) { ESTIMATES = m; }
/** Stima per canale e struttura, se ce ne sono abbastanza dati; altrimenti undefined. */
export function commissionEstimateFor(channel: string, structureId?: string): number | undefined {
  return ESTIMATES[key(channel, structureId)];
}
