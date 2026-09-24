// ============================================================
//  Fee di piattaforma Xenora (Stripe Connect, direct charges).
//  Pura, senza I/O: facile da testare. Tutti gli importi in CENTESIMI interi.
//
//  Regole (spec 21 set 2026):
//   - la fee si applica SOLO ai pagamenti di prenotazioni source='direct'
//     (mini-sito / booking engine); OTA e inserimenti manuali → nessuna fee;
//   - default 1,5% (150 bps) + IVA 22% → application_fee = round(gross × bps/10000 × (1+IVA));
//   - disattivata per soggetti senza P.IVA (has_vat_number=false) → default OFF;
//   - la paga la struttura (è sul suo account), mai l'ospite: nessuna voce nel checkout.
// ============================================================

export type PaymentSource = "direct" | "ota" | "manual";

export interface FeeConfig {
  /** punti base: 150 = 1,5% */
  bps?: number;
  /** aliquota IVA sulla fee, in percentuale: 22 = 22% */
  vatRate?: number;
  /** fee abilitata per il tenant */
  enabled?: boolean;
  /** la struttura ha P.IVA (senza → fee OFF) */
  hasVatNumber?: boolean;
}

export interface FeeResult {
  applies: boolean;
  baseCents: number;   // imponibile della fee
  vatCents: number;    // IVA sulla fee
  totalCents: number;  // base + IVA = application_fee_amount da passare a Stripe
  bps: number;
  vatRate: number;
}

export const DEFAULT_FEE_BPS = 150;      // 1,5%
export const DEFAULT_FEE_VAT_RATE = 22;  // 22%

const round = (n: number) => Math.round(n);

/**
 * Calcola la fee di piattaforma per UN pagamento.
 * base+IVA quadrano sempre col totale: total = round(gross×bps/10000×(1+iva)),
 * base = round(gross×bps/10000), iva = total − base.
 */
export function computePlatformFee(grossCents: number, source: PaymentSource, cfg: FeeConfig = {}): FeeResult {
  const bps = Number.isFinite(cfg.bps) ? (cfg.bps as number) : DEFAULT_FEE_BPS;
  const vatRate = Number.isFinite(cfg.vatRate) ? (cfg.vatRate as number) : DEFAULT_FEE_VAT_RATE;
  const enabled = cfg.enabled !== false;         // default: abilitata…
  const hasVat = cfg.hasVatNumber === true;      // …ma solo se la struttura ha P.IVA

  const applies = source === "direct" && enabled && hasVat && grossCents > 0 && bps > 0;
  if (!applies) return { applies: false, baseCents: 0, vatCents: 0, totalCents: 0, bps, vatRate };

  const totalCents = round((grossCents * bps / 10000) * (1 + vatRate / 100));
  const baseCents = round(grossCents * bps / 10000);
  const vatCents = totalCents - baseCents;
  return { applies: true, baseCents, vatCents, totalCents, bps, vatRate };
}

// Stima della commissione di elaborazione Stripe (carte SEE/EEA: 1,5% + 0,25€).
// Usata per i DESTINATION charge: si trasferisce alla struttura il netto (lordo − questa stima),
// così la commissione Stripe resta a carico della struttura e la piattaforma non ci rimette.
// Le carte extra-UE costano di più: in quei casi la piccola differenza la assorbe la piattaforma.
export function estimatedStripeFeeCents(grossCents: number): number {
  if (grossCents <= 0) return 0;
  return Math.round(grossCents * 0.015) + 25;
}

/** Rimborso proporzionale della fee quando si rimborsa parte dell'incasso. */
export function proratedFeeRefundCents(fee: Pick<FeeResult, "totalCents">, grossCents: number, refundGrossCents: number): number {
  if (grossCents <= 0 || refundGrossCents <= 0) return 0;
  const ratio = Math.min(1, refundGrossCents / grossCents);
  return Math.round(fee.totalCents * ratio);
}
