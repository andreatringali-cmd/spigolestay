// Pagamenti ONLINE (Stripe) di una prenotazione: quando i soldi sono entrati davvero. Modulo puro, condiviso da Cassa, server e test.
//
// Una prenotazione DIRETTA pagata online (dal sito ufficiale, o col link di pagamento) è già incassata il giorno del pagamento, non il giorno
// di arrivo. Sulla prenotazione si salvano due campi:
//   - paidOnline: quanto è stato versato online in totale (€);
//   - paidAt:     la data (yyyy-mm-dd, fuso Europe/Rome) dell'ULTIMO pagamento online.
// Con più pagamenti online (acconto alla prenotazione + saldo dopo) i due campi non bastano a datarli uno per uno: l'importo online è la somma,
// la data è quella dell'ultimo (scelta prudente: non si riconosce mai un incasso prima che sia arrivato tutto).
// Quanto è stato incassato in altro modo (es. saldo in contanti all'arrivo) è la differenza `paid − paidOnline`.
import { ymdRome } from "./dates-rome";
import { roundCents } from "./money";

type OnlineLike = {
  channel?: string;
  checkIn?: string;
  bookedOn?: string;
  updatedAt?: number;
  paid?: number | null;
  paidOnline?: number | null;
  paidAt?: string | null;
  stripePaymentIntent?: string | null;
};

const isISO = (s: unknown): s is string => typeof s === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s);

/** Prenotazione diretta con pagamento online: per le OTA (anche se qualcuno ha pagato con un link) vale la data di accredito del canale. */
export function isOnlineDirect(b: OnlineLike): boolean {
  if (b.channel !== "direct") return false;
  return !!b.stripePaymentIntent || (typeof b.paidOnline === "number" && b.paidOnline > 0);
}

export interface OnlineIncasso {
  /** Data in cui sono entrati i soldi pagati online. */
  date: string;
  /** Parte incassata online (≤ paid). */
  amount: number;
  /** Parte incassata in altro modo (paid − amount): la data resta quella prevista dal canale. */
  rest: number;
  /** true = la data è stimata (prenotazione registrata prima che si salvasse paidAt). */
  approx: boolean;
}

/**
 * Come si divide l'incassato di una prenotazione diretta pagata online. null = non è una diretta pagata online (o nulla incassato).
 * Per le prenotazioni registrate prima dell'introduzione di paidAt/paidOnline (ripiego APPROSSIMATO): tutto l'incassato conta come online e
 * la data è il giorno della prenotazione (bookedOn), altrimenti il giorno dell'ultima modifica (updatedAt, fuso Roma); mai oltre l'arrivo.
 */
export function onlineIncasso(b: OnlineLike): OnlineIncasso | null {
  if (!isOnlineDirect(b)) return null;
  const paid = roundCents(Math.max(0, b.paid ?? 0));
  if (paid <= 0) return null;
  const amount = typeof b.paidOnline === "number" && Number.isFinite(b.paidOnline) ? Math.min(paid, roundCents(Math.max(0, b.paidOnline))) : paid;
  const rest = roundCents(paid - amount);
  if (isISO(b.paidAt)) return { date: b.paidAt, amount, rest, approx: false };
  let d = isISO(b.bookedOn) ? b.bookedOn : "";
  if (!d && typeof b.updatedAt === "number" && Number.isFinite(b.updatedAt)) { try { d = ymdRome(b.updatedAt); } catch { d = ""; } }
  if (!d || (isISO(b.checkIn) && d > b.checkIn)) d = isISO(b.checkIn) ? b.checkIn : d;
  return { date: d, amount, rest, approx: true };
}

/**
 * Campi da aggiungere alla prenotazione quando arriva un pagamento online di `amount` € (adesso = `nowMs`).
 * La base di partenza è paidOnline se c'è; per una prenotazione Stripe vecchia (senza paidOnline) è quanto già incassato, coerente col ripiego
 * di onlineIncasso: così un saldo pagato dopo non fa "scivolare" l'acconto già online tra gli incassi non online.
 */
export function onlinePaymentPatch(b: OnlineLike, amount: number, nowMs: number): { paidOnline: number; paidAt: string } {
  const before = typeof b.paidOnline === "number" && Number.isFinite(b.paidOnline) ? b.paidOnline : b.stripePaymentIntent ? Math.max(0, b.paid ?? 0) : 0;
  return { paidOnline: roundCents(before + Math.max(0, amount)), paidAt: ymdRome(nowMs) };
}
