// Definizione dei piani a canone mensile (condivisa client/server).
// Gli importi qui devono restare allineati a quelli mostrati in /abbonamento.
import { ANNUAL_OFF } from "@/lib/plans";

export type PlanKey = "basic" | "pro" | "ultimate";
export type BillingInterval = "month" | "year";

export interface StripePlan {
  key: PlanKey;
  name: string;
  amount: number; // €/mese
}

// IMPORTANTE: allineati ai prezzi mostrati in /abbonamento (src/lib/plans.ts TIERS).
export const STRIPE_PLANS: StripePlan[] = [
  { key: "basic", name: "Basic", amount: 29 },
  { key: "pro", name: "Pro", amount: 59 },
  { key: "ultimate", name: "Ultimate", amount: 99 },
];

export const planByKey = (k?: string | null): StripePlan | undefined =>
  STRIPE_PLANS.find((p) => p.key === k);

// Fatturazione annuale: -20% (ANNUAL_OFF), addebitato in un'unica soluzione una volta l'anno
// (non è il "/mese" scontato mostrato in UI, ma il totale annuo corrispondente).
// Es. Basic 29€/mese → 29*12*0.8 = 278€/anno.
export const annualAmount = (plan: StripePlan): number =>
  Math.round(plan.amount * 12 * (1 - ANNUAL_OFF));

// Chiave stabile usata per l'auto-provisioning dei Price su Stripe (una per piano+intervallo).
export const lookupKeyFor = (plan: StripePlan, interval: BillingInterval): string =>
  `xenora_${plan.key}_${interval}`;
