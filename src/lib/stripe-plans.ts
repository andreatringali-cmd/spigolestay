// Definizione dei piani a canone mensile (condivisa client/server).
// Gli importi qui devono restare allineati a quelli mostrati in /abbonamento.
export type PlanKey = "basic" | "pro" | "ultimate";

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
