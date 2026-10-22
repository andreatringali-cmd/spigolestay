// Politica del piano tariffario scelto, ricalcolata SUL SERVER (puro, nessun import).
// Il browser dell'ospite manda solo il NOME del piano: percentuale di caparra, rimborsabilita' e giorni di cancellazione gratuita
// si ricavano dai piani del proprietario (spigolestay:rateplans) e non da cio' che dichiara il client. Le regole sono le stesse di
// lib/rate-plans.ts (planApplies / planDepositPct): qui sono ripetute perche' quel modulo importa il client Supabase del browser.
// La CANCELLAZIONE non e' piu' del piano: la decide la scheda struttura, uguale per tutti i piani. Stessa tabella di lib/cancel-policy.ts (un test controlla che coincidano):
// qui e' ripetuta perche' questo modulo resta senza import.
const STRUCTURE_CANCEL: Record<string, { refundable: boolean; days: number }> = { flessibile: { refundable: true, days: 1 }, moderata: { refundable: true, days: 7 }, rigida: { refundable: false, days: 0 } };
const withStructureCancel = <T extends { refundable?: boolean; cancelDays?: number }>(plan: T, kind: unknown): T => {
  const r = typeof kind === "string" ? STRUCTURE_CANCEL[kind] : undefined;
  return r ? { ...plan, refundable: r.refundable, cancelDays: r.refundable ? r.days : 0 } : plan;
};

export interface PlanLike {
  id?: string; name?: string; adjPct?: number; refundable?: boolean; minStay?: number; enabled?: boolean;
  cancelDays?: number; deposit?: "none" | "deposit" | "prepaid"; depositPct?: number;
  dateFrom?: string; dateTo?: string; roomTypeIds?: string[]; structureId?: string;
}

/** Piani predefiniti del motore di prenotazione (come DEFAULT_PLANS di prenota/page.tsx) quando il proprietario non ne ha salvati. */
export const DEFAULT_SERVER_PLANS: PlanLike[] = [
  { id: "flex", name: "Flessibile", adjPct: 0, refundable: true, minStay: 1, cancelDays: 3, deposit: "none" },
  { id: "nonref", name: "Non rimborsabile", adjPct: -10, refundable: false, minStay: 1, deposit: "prepaid" },
  { id: "long", name: "Lunga permanenza", adjPct: -12, refundable: true, minStay: 5, cancelDays: 7, deposit: "deposit", depositPct: 30 },
];

/** % di acconto richiesta dal piano (come planDepositPct). */
export function planDepositPctOf(p: PlanLike): number {
  if (!p.refundable) return 100;
  if (p.deposit === "prepaid") return 100;
  if (p.deposit === "deposit") return Math.min(100, Math.max(0, Math.round(p.depositPct ?? 30)));
  return 0;
}

function applies(p: PlanLike, o: { roomTypeId: string; checkIn: string; nights: number; structureId: string }): boolean {
  if (p.enabled === false) return false;
  if (p.structureId && p.structureId !== o.structureId) return false;
  if (p.roomTypeIds && p.roomTypeIds.length && !p.roomTypeIds.includes(o.roomTypeId)) return false;
  if (o.nights > 0 && (p.minStay ?? 1) > o.nights) return false;
  if (p.dateFrom && o.checkIn < p.dateFrom) return false;
  if (p.dateTo && o.checkIn > p.dateTo) return false;
  return true;
}

export interface ResolvedPolicy {
  /** il piano e' stato trovato tra quelli del proprietario e vale per queste date/tipologia */
  found: boolean;
  planName: string;
  refundable: boolean;
  cancelDays: number;
  /** % di acconto da incassare adesso (0-100). Piano non trovato = 100: si paga tutto e non e' rimborsabile. */
  depositPct: number;
  adjPct: number;
}

/** Politica applicabile: il piano con quel nome tra quelli del proprietario (o predefiniti). Se non esiste o non vale per le date: prepagato, non rimborsabile. */
export function resolvePlanPolicy(
  plans: unknown[] | null | undefined, planName: string,
  o: { roomTypeId: string; checkIn: string; nights: number; structureId: string; cancelPolicy?: unknown },
): ResolvedPolicy {
  const list = (Array.isArray(plans) && plans.length ? plans : DEFAULT_SERVER_PLANS).filter((x): x is PlanLike => !!x && typeof x === "object");
  const want = String(planName || "").trim().toLowerCase();
  const p = want ? list.find((x) => String(x.name || "").trim().toLowerCase() === want && applies(x, o)) : undefined;
  if (!p) return { found: false, planName: String(planName || ""), refundable: false, cancelDays: 0, depositPct: 100, adjPct: 0 };
  const eff = withStructureCancel(p, o.cancelPolicy); // politica della struttura (se scelta) al posto di quella del piano
  const refundable = eff.refundable === true;
  return {
    found: true, planName: String(p.name || planName), refundable,
    cancelDays: refundable ? Math.max(0, Math.round(Number(eff.cancelDays) || 0)) : 0,
    depositPct: planDepositPctOf(eff),
    adjPct: Number(p.adjPct) || 0,
  };
}

/**
 * Importo da incassare ora, in centesimi. Il client puo' proporre una cifra (la pagina calcola l'acconto anche su tassa ed extra),
 * ma non scendere sotto il minimo del piano (pct del totale soggiorno) ne' superare il totale.
 * 0 = nessun pagamento online (il piano non prevede anticipo).
 */
export function depositCentsFor(totalEur: number, clientDepositEur: number, pct: number): number {
  const total = Math.round((Number(totalEur) || 0) * 100);
  if (total <= 0 || pct <= 0) return 0;
  const min = Math.round((total * Math.min(100, pct)) / 100);
  const asked = Math.round((Number(clientDepositEur) || 0) * 100);
  return Math.min(total, Math.max(min, asked));
}
