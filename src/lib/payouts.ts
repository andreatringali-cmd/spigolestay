// Quando i soldi di una prenotazione arrivano davvero sul conto, per canale.
// Molte OTA non pagano alla data di arrivo: Booking con bonifico settimanale (parte il giovedì) o mensile, Expedia mensile o carta virtuale,
// HotelBeds carta virtuale. Le impostazioni sono per canale; senza impostazioni vale la data di arrivo (come prima).
// Chiave sincronizzata con l'account (prefisso "spigolestay:").
import type { Channel } from "./types";
import { shiftISO } from "./dates";

export type PayoutMode = "arrival" | "checkout" | "weekly" | "monthly";
export interface PayoutRule {
  mode: PayoutMode;
  days?: number;     // checkout: giorni dopo il check-out (0 = il giorno stesso)
  weekday?: number;  // weekly: giorno del bonifico, 0 = domenica … 6 = sabato
  monthDay?: number; // monthly: giorno del mese successivo al check-out in cui arriva il bonifico
}
export type PayoutSettings = Partial<Record<Channel, PayoutRule>>;

export const PAYOUT_CHANNELS: Channel[] = ["booking", "expedia", "hotelbeds", "airbnb", "agoda", "google", "other"];
export const WEEKDAY_LABELS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];

const KEY = "spigolestay:cassa:payouts";
const MODES: PayoutMode[] = ["arrival", "checkout", "weekly", "monthly"];

/** Ripulisce un'impostazione letta dal browser: valori fuori range tornano ai predefiniti. */
export function cleanRule(r: unknown): PayoutRule {
  const o = (r && typeof r === "object" ? r : {}) as Partial<PayoutRule>;
  const mode: PayoutMode = MODES.includes(o.mode as PayoutMode) ? (o.mode as PayoutMode) : "arrival";
  const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  return { mode, days: int(o.days, 0, 60, 0), weekday: int(o.weekday, 0, 6, 4), monthDay: int(o.monthDay, 1, 31, 1) };
}
export function loadPayoutSettings(): PayoutSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, unknown>;
    const out: PayoutSettings = {};
    for (const ch of PAYOUT_CHANNELS) if (raw[ch]) out[ch] = cleanRule(raw[ch]);
    return out;
  } catch { return {}; }
}
export function savePayoutSettings(s: PayoutSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage non disponibile */ } }

const pad = (n: number) => String(n).padStart(2, "0");
const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const daysInMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();

/** Data in cui i soldi della prenotazione arrivano sul conto. */
export function payoutDate(b: { channel: Channel; checkIn: string; checkOut: string }, settings: PayoutSettings): string {
  const rule = settings[b.channel];
  if (!rule || rule.mode === "arrival" || b.channel === "direct") return b.checkIn;
  const out = b.checkOut || b.checkIn;
  if (rule.mode === "checkout") return shiftISO(out, rule.days ?? 0);
  if (rule.mode === "weekly") {
    // bonifico del giorno X: copre i check-out dal X della settimana prima fino al giorno prima → il primo X DOPO il check-out
    const wd = rule.weekday ?? 4;
    let d = shiftISO(out, 1);
    for (let i = 0; i < 7 && weekdayOf(d) !== wd; i++) d = shiftISO(d, 1);
    return d;
  }
  // mensile: tutti i check-out del mese, pagati il giorno scelto del mese dopo
  let y = Number(out.slice(0, 4)), m = Number(out.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${pad(m)}-${pad(Math.min(rule.monthDay ?? 1, daysInMonth(y, m)))}`;
}

/** Descrizione breve ("Bonifico settimanale · giovedì"). */
export function payoutSummary(rule: PayoutRule | undefined): string {
  if (!rule || rule.mode === "arrival") return "Alla data di arrivo";
  if (rule.mode === "checkout") return rule.days ? `${rule.days} giorni dopo il check-out` : "Al check-out";
  if (rule.mode === "weekly") return `Bonifico settimanale · ${WEEKDAY_LABELS[rule.weekday ?? 4].toLowerCase()}`;
  return `Bonifico mensile · il ${rule.monthDay ?? 1} del mese dopo`;
}
