// Piani tariffari: modello condiviso e logica di applicazione al booking/preventivo.
// I piani sono definiti nella pagina "Piani tariffari" e salvati in localStorage.

export type DepositId = "none" | "deposit" | "prepaid";

export interface RatePlan {
  id: string;
  name: string;
  adjPct: number;          // scarto % sul prezzo del giorno
  refundable: boolean;
  board: string;           // trattamento
  minStay: number;         // notti minime
  enabled?: boolean;
  cancelDays?: number;     // cancellazione gratuita fino a N giorni prima (se rimborsabile)
  deposit?: DepositId;     // politica di incasso
  depositPct?: number;     // % acconto se deposit = "deposit"
  dateFrom?: string;       // intervallo temporale (ISO), assente = sempre
  dateTo?: string;
  roomTypeIds?: string[];  // tipologie a cui si applica (assente/vuoto = tutte)
  description?: string;
}

import { lsGet } from "./publicdata";

export const RATE_PLANS_KEY = "spigolestay:rateplans";

export function loadPlans(): RatePlan[] {
  try { const p = lsGet(RATE_PLANS_KEY); if (p) { const a = JSON.parse(p); if (Array.isArray(a) && a.length) return a as RatePlan[]; } } catch {}
  return [];
}

// Il piano è offerto per queste date / tipologia / durata?
export function planApplies(p: RatePlan, opts: { roomTypeId?: string; checkIn?: string; nights?: number }): boolean {
  if (p.enabled === false) return false;
  if (p.roomTypeIds && p.roomTypeIds.length && opts.roomTypeId && !p.roomTypeIds.includes(opts.roomTypeId)) return false;
  if (typeof opts.nights === "number" && opts.nights > 0 && p.minStay > opts.nights) return false;
  // Intervallo temporale valutato sul check-in
  if (p.dateFrom && opts.checkIn && opts.checkIn < p.dateFrom) return false;
  if (p.dateTo && opts.checkIn && opts.checkIn > p.dateTo) return false;
  return true;
}

// % di acconto richiesto dal piano (politica di incasso).
export function planDepositPct(p: RatePlan): number {
  if (!p.refundable) return 100;                 // non rimborsabile → prepagato intero
  if (p.deposit === "prepaid") return 100;
  if (p.deposit === "deposit") return Math.min(100, Math.max(0, Math.round(p.depositPct ?? 30)));
  return 0;                                       // nessun anticipo
}

// Testo della politica di cancellazione, con lingua opzionale (default IT).
export function cancelText(p: RatePlan, lang: "it" | "en" = "it"): string {
  if (!p.refundable) return lang === "en" ? "Non-refundable" : "Non rimborsabile";
  if (p.cancelDays && p.cancelDays > 0)
    return lang === "en" ? `Free cancellation up to ${p.cancelDays} days before` : `Cancellazione gratuita fino a ${p.cancelDays} giorni prima`;
  return lang === "en" ? "Free cancellation" : "Cancellazione gratuita";
}
