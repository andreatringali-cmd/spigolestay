// Come è stata (o sarà) incassata una prenotazione. Modulo puro, condiviso da scheda prenotazione, Cassa e fatture.
//
//  - contanti / carta / bonifico / altro: scelti a mano dal gestore (Booking.paymentMethod).
//  - ota ("Incasso OTA"): NON si sceglie, si deduce. Se l'OTA incassa dall'ospite e poi versa alla struttura (Booking.com con "Payment by
//    Booking.com", Expedia con pagamento netto, Airbnb, carta virtuale…), il metodo è quello e basta, qualunque cosa sia stata salvata.
//
// Il metodo scelto resta coerente con la Cassa (conto su cui finisce l'incasso) e con i codici di pagamento della fattura elettronica
// (invoicing/payment-codes.ts: la fattura riceve il TESTO "Bonifico bancario"/"Carta"/"Contanti", che sdiPaymentCode traduce in MPxx).

import { isNetPayout } from "./commission-estimate";

export type PayMethod = "bonifico" | "contanti" | "carta" | "altro" | "ota";

/** Metodi che il gestore sceglie a mano. */
export const MANUAL_PAY_METHODS: PayMethod[] = ["bonifico", "contanti", "carta", "altro"];

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  bonifico: "Bonifico",
  contanti: "Contanti",
  carta: "Carta / POS",
  altro: "Altro",
  ota: "Incasso OTA",
};

export const isPayMethod = (v: unknown): v is PayMethod => typeof v === "string" && (v in PAY_METHOD_LABEL);

type PayBookingLike = {
  channel?: string;
  paymentMethod?: PayMethod;
  netTotal?: boolean;
  extId?: string;
  paymentFee?: number | null;
  otaCard?: { present?: boolean } | null;
  otaInfo?: { paymentCollect?: "property" | "ota"; paymentType?: "credit_card" | "bank_transfer" } | null;
  /** Riferimento del pagamento online Stripe: se c'è, l'ospite ha pagato con carta sul sito/link. */
  stripePaymentIntent?: string | null;
};

/** Canali che non sono OTA: la prenotazione è diretta o è un blocco. */
const isOtaChannel = (channel?: string) => !!channel && channel !== "direct" && channel !== "blocked";

/**
 * L'OTA incassa dall'ospite al posto della struttura? Vero quando l'OTA lo dichiara (Channex: payment_collect = ota), quando il totale è già il
 * pagamento netto dell'OTA (Expedia), quando c'è una carta virtuale o un "Payment charge" (Booking.com trattiene il costo d'incasso solo se incassa
 * lui), e per Airbnb (incassa sempre). Se l'OTA dichiara che è la struttura a incassare (payment_collect = property) è falso, qualunque altro indizio.
 */
export function otaCollectsPayment(b: PayBookingLike): boolean {
  if (!isOtaChannel(b.channel)) return false;
  const pc = b.otaInfo?.paymentCollect;
  if (pc === "property") return false;
  if (pc === "ota") return true;
  if (isNetPayout(b)) return true;
  if (b.otaCard?.present) return true;
  if (b.paymentFee != null && b.paymentFee > 0) return true;
  return b.channel === "airbnb";
}

export interface EffectivePayMethod {
  /** Metodo in vigore; undefined = non ancora indicato. */
  method?: PayMethod;
  /** true = dedotto dai dati dell'OTA, non modificabile dall'utente. */
  auto: boolean;
  /** true = «Carta» dedotta dal pagamento online (Stripe) perché il gestore non ha scelto nulla. Resta modificabile (auto = false): se il gestore sceglie un metodo, quello vince. */
  online?: boolean;
}

/** Etichetta del metodo dedotto dal pagamento online (quando `EffectivePayMethod.online` è true). */
export const ONLINE_PAY_LABEL = "Carta · pagamento online (automatico)";

/** Metodo di incasso in vigore: "Incasso OTA" automatico se l'OTA incassa, altrimenti quello scelto dal gestore (se c'è). */
export function effectivePayMethod(b: PayBookingLike): EffectivePayMethod {
  if (otaCollectsPayment(b)) return { method: "ota", auto: true };
  const m = isPayMethod(b.paymentMethod) ? b.paymentMethod : undefined;
  // "ota" scelto a mano su un canale non-OTA non ha senso: si ignora.
  const chosen = m === "ota" && !isOtaChannel(b.channel) ? undefined : m;
  // Prenotazione diretta pagata online con Stripe e nessun metodo scelto dal gestore: è una carta (il metodo scelto a mano, se c'è, vince).
  if (!chosen && b.channel === "direct" && b.stripePaymentIntent) return { method: "carta", auto: false, online: true };
  return { method: chosen, auto: false };
}

/** Dettaglio leggibile dell'incasso OTA ("carta virtuale", "bonifico dell'OTA"), per le etichette. */
export function otaPayDetail(b: PayBookingLike): string | undefined {
  if (b.otaCard?.present || b.otaInfo?.paymentType === "credit_card") return "carta virtuale";
  if (b.otaInfo?.paymentType === "bank_transfer") return "bonifico";
  return undefined;
}

/**
 * Testo del metodo di pagamento da mettere sulla fattura/ricevuta. È il testo che `sdiPaymentCode` sa tradurre nel codice SdI:
 * contanti → MP01, carta → MP08, bonifico → MP05. L'incasso OTA è un versamento dell'OTA alla struttura (bonifico), salvo carta virtuale (carta).
 * undefined = nessuna indicazione: la fattura usa il suo valore predefinito.
 */
export function invoicePayMethodLabel(b: PayBookingLike): string | undefined {
  const { method } = effectivePayMethod(b);
  switch (method) {
    case "contanti": return "Contanti";
    case "carta": return "Carta";
    case "bonifico": return "Bonifico bancario";
    case "altro": return "Bonifico bancario";
    case "ota": return b.otaCard?.present || b.otaInfo?.paymentType === "credit_card" ? "Carta" : "Bonifico bancario";
    default: return undefined;
  }
}

/**
 * Conto di Cassa su cui finisce l'incasso automatico di una prenotazione. Senza metodo indicato resta il comportamento storico:
 * diretta → contanti, OTA → conto principale. `validConti`: chiavi dei conti esistenti (un conto eliminato non riceve movimenti).
 */
export function cassaContoFor(b: PayBookingLike, principal: string, validConti?: string[], accounts?: { cash?: string; card?: string }): string {
  const { method } = effectivePayMethod(b);
  const ok = (k: string) => !validConti || validConti.includes(k);
  // Con `accounts` (conti PER STRUTTURA) contanti e carta cadono sul conto di quel tipo della struttura; se la struttura non ne ha uno adatto, sul suo principale.
  // Senza (vecchio comportamento, stessi conti per tutti): chiave storica "contanti" / "carta".
  const cash = () => (accounts ? (accounts.cash ?? principal) : "contanti"); // storico: conto fisso, non si può eliminare (CONTI_FISSI)
  const card = () => (accounts ? (accounts.card ?? principal) : ok("carta") ? "carta" : principal);
  switch (method) {
    case "contanti": return cash();
    case "carta": return card();
    case "bonifico":
    case "altro":
    case "ota": return principal;
    default: return b.channel === "direct" ? cash() : principal;
  }
}
