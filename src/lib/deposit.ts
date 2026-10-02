// Acconto richiesto sulla prenotazione diretta (motore prenotazioni).
// Per struttura: Structure.depositPct (0 = nessun acconto). Se la struttura non ha un valore proprio
// si usa la vecchia voce globale (fallback retro-compatibile).
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

// Acconto di una struttura: il suo depositPct se impostato, altrimenti la voce globale.
export function depositFor(structure?: { depositPct?: number }): DepositCfg {
  if (structure && typeof structure.depositPct === "number") {
    const pct = Math.max(0, Math.min(100, Math.round(structure.depositPct)));
    return { on: pct > 0, pct };
  }
  return loadDeposit();
}

export function saveDeposit(d: DepositCfg) {
  try { localStorage.setItem(KEY, JSON.stringify({ on: !!d.on, pct: Math.max(0, Math.min(100, Number(d.pct) || 0)) })); } catch {}
}
