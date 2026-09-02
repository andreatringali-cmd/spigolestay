// Limiti e prezzi legati al piano di abbonamento (allineati alla pagina Abbonamento).
export const ROOMS_PER_STRUCT = 6; // camere incluse per struttura
export const ROOM_OVERAGE = 4;     // €/camera/mese oltre le incluse

export const PLAN_STRUCTURES: Record<string, number> = { basic: 1, pro: 3, ultimate: 8 };
export const PLAN_NAME: Record<string, string> = { basic: "Basic", pro: "Pro", ultimate: "Ultimate" };

export function currentPlanKey(): string {
  try { return localStorage.getItem("spigolestay:plan") || localStorage.getItem("spigolestay:tier") || "basic"; } catch { return "basic"; }
}
export function planStructureLimit(): number { return PLAN_STRUCTURES[currentPlanKey()] ?? 1; }
export function planName(): string { return PLAN_NAME[currentPlanKey()] ?? "Basic"; }
