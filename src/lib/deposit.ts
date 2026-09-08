// Acconto richiesto sulla prenotazione diretta (motore prenotazioni).
// Voce UNICA per tutte le strutture: si decide se richiederlo e con quale percentuale.
export interface DepositCfg { on: boolean; pct: number }

const KEY = "spigolestay:deposit";
const DEFAULT: DepositCfg = { on: true, pct: 30 };

export function loadDeposit(): DepositCfg {
  try {
    const r = localStorage.getItem(KEY);
    if (r) { const d = JSON.parse(r); return { on: d.on !== false, pct: Math.max(0, Math.min(100, Number(d.pct) || 0)) }; }
  } catch {}
  return { ...DEFAULT };
}

export function saveDeposit(d: DepositCfg) {
  try { localStorage.setItem(KEY, JSON.stringify({ on: !!d.on, pct: Math.max(0, Math.min(100, Number(d.pct) || 0)) })); } catch {}
}
