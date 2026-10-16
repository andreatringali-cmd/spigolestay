// Quando i soldi di una prenotazione arrivano davvero sul conto, per canale.
// Molte OTA non pagano alla data di arrivo: Booking con bonifico settimanale (parte il giovedì) o mensile, Expedia mensile o carta virtuale,
// HotelBeds carta virtuale. Le impostazioni sono per struttura e per canale; senza impostazioni vale la data di arrivo (come prima).
// Chiave sincronizzata con l'account (prefisso "spigolestay:").
import type { Channel } from "./types";
import { shiftISO } from "./dates";

export type PayoutMode = "arrival" | "checkout" | "weekly" | "monthly";
/** Commissioni del portale trattenute TUTTE INSIEME: il giorno `day` (1..28) del mese dopo il mese del check-out (es. Booking.com fattura il 15 le prenotazioni del mese prima). */
export interface CommissionRule { mode: "monthly"; day: number }
export const COMMISSION_DEFAULT_DAY = 15;
export const COMMISSION_MAX_DAY = 28; // fino al 28: esiste in ogni mese, nessun giorno "oltre la fine del mese"
export interface PayoutRule {
  mode: PayoutMode;
  days?: number;     // checkout: giorni dopo il check-out (0 = il giorno stesso)
  weekday?: number;  // weekly: giorno del bonifico, 0 = domenica … 6 = sabato
  monthDay?: number; // monthly: giorno del mese successivo al check-out in cui arriva il bonifico
  commission?: CommissionRule; // assente = commissioni "insieme all'incasso" (come sempre); presente = un'unica trattenuta mensile (vedi computeAuto)
}
/** Impostazioni di UNA struttura: regola per canale. */
export type PayoutSettings = Partial<Record<Channel, PayoutRule>>;
/** Impostazioni salvate: per struttura. La chiave "*" sono le predefinite (valgono per le strutture che non ne hanno di proprie). */
export type PayoutSettingsMap = Record<string, PayoutSettings>;
export const DEFAULT_PAYOUTS_ID = "*";

export const PAYOUT_CHANNELS: Channel[] = ["booking", "expedia", "hotelbeds", "airbnb", "agoda", "google", "other"];
export const WEEKDAY_LABELS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];

const KEY = "spigolestay:cassa:payouts";
const MODES: PayoutMode[] = ["arrival", "checkout", "weekly", "monthly"];
const KNOWN_CHANNELS: string[] = [...PAYOUT_CHANNELS, "direct", "blocked"];

/** Ripulisce un'impostazione letta dal browser: valori fuori range tornano ai predefiniti. */
export function cleanRule(r: unknown): PayoutRule {
  const o = (r && typeof r === "object" ? r : {}) as Partial<PayoutRule>;
  const mode: PayoutMode = MODES.includes(o.mode as PayoutMode) ? (o.mode as PayoutMode) : "arrival";
  const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const out: PayoutRule = { mode, days: int(o.days, 0, 60, 0), weekday: int(o.weekday, 0, 6, 4), monthDay: int(o.monthDay, 1, 31, 1) };
  // Le commissioni mensili si salvano solo se impostate: chi non le usa mantiene lo stesso formato di prima.
  const c = o.commission as unknown;
  if (c && typeof c === "object" && (c as { mode?: unknown }).mode === "monthly") out.commission = { mode: "monthly", day: int((c as { day?: unknown }).day, 1, COMMISSION_MAX_DAY, COMMISSION_DEFAULT_DAY) };
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Formato VECCHIO (globale): oggetto le cui chiavi sono canali noti. */
function isLegacy(raw: Record<string, unknown>): boolean { return Object.keys(raw).some((k) => KNOWN_CHANNELS.includes(k)); }
function cleanSettings(raw: unknown): PayoutSettings {
  const out: PayoutSettings = {};
  if (isObj(raw)) for (const ch of PAYOUT_CHANNELS) if (raw[ch]) out[ch] = cleanRule(raw[ch]);
  return out;
}
/** Legge un valore salvato (nuovo formato per struttura, oppure vecchio globale → diventa le predefinite "*") e lo ripulisce. */
export function normalizePayoutMap(raw: unknown): PayoutSettingsMap {
  if (!isObj(raw)) return {};
  if (isLegacy(raw)) { const d = cleanSettings(raw); return Object.keys(d).length ? { [DEFAULT_PAYOUTS_ID]: d } : {}; }
  const out: PayoutSettingsMap = {};
  for (const [id, v] of Object.entries(raw)) if (isObj(v)) out[id] = cleanSettings(v);
  return out;
}
/** Impostazioni valide per una struttura: proprie → altrimenti predefinite ("*") → altrimenti nessuna. Accetta anche il formato vecchio. */
export function payoutSettingsFor(map: PayoutSettingsMap | PayoutSettings | undefined | null, structureId: string | undefined | null): PayoutSettings {
  if (!isObj(map)) return {};
  const m = (isLegacy(map) ? { [DEFAULT_PAYOUTS_ID]: map } : map) as PayoutSettingsMap;
  if (structureId && structureId !== DEFAULT_PAYOUTS_ID && m[structureId]) return m[structureId];
  return m[DEFAULT_PAYOUTS_ID] ?? {};
}
/** La struttura ha impostazioni PROPRIE (non solo ereditate dalle predefinite)? */
export const hasOwnPayouts = (map: PayoutSettingsMap, structureId: string) => !!map[structureId];
/** Le prenotazioni di questo canale, in questa struttura, vengono pagate con un bonifico unico (settimanale/mensile)? */
export function isGroupedPayout(map: PayoutSettingsMap, channel: string, structureId: string | undefined | null): boolean {
  const rule = (payoutSettingsFor(map, structureId) as Record<string, PayoutRule | undefined>)[channel];
  return rule?.mode === "weekly" || rule?.mode === "monthly";
}
export function loadPayoutSettings(): PayoutSettingsMap {
  try { return normalizePayoutMap(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return {}; }
}
export function savePayoutSettings(s: PayoutSettingsMap) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage non disponibile */ } }

const pad = (n: number) => String(n).padStart(2, "0");
const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const daysInMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();

/** Data in cui i soldi della prenotazione arrivano sul conto, con le impostazioni della STRUTTURA della prenotazione. */
export function payoutDate(b: { channel: Channel; checkIn: string; checkOut: string; structureId?: string }, settings: PayoutSettingsMap): string {
  const rule = payoutSettingsFor(settings, b.structureId)[b.channel];
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

/** Regola "commissioni tutte insieme" di un portale in una struttura (undefined = commissioni insieme all'incasso, come sempre). */
export function commissionRuleFor(map: PayoutSettingsMap, channel: string, structureId: string | undefined | null): CommissionRule | undefined {
  if (channel === "direct" || channel === "blocked") return undefined;
  const rule = (payoutSettingsFor(map, structureId) as Record<string, PayoutRule | undefined>)[channel];
  return rule?.commission?.mode === "monthly" ? rule.commission : undefined;
}
/**
 * Mese a cui appartiene una prenotazione per la fatturazione delle commissioni: quello del CHECK-OUT (ipotesi: è così che Booking.com fattura, il 15 di febbraio
 * le prenotazioni con check-out a gennaio). Formato "aaaa-mm".
 */
export const commissionMonthOf = (b: { checkIn: string; checkOut: string }) => (b.checkOut || b.checkIn).slice(0, 7);
/** Data in cui il portale trattiene le commissioni del mese "aaaa-mm": il giorno scelto del mese successivo. */
export function commissionDateFor(ym: string, day: number): string {
  let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${pad(m)}-${pad(Math.min(Math.max(1, day), daysInMonth(y, m)))}`;
}

/** Descrizione breve ("Bonifico settimanale · giovedì"). */
export function payoutSummary(rule: PayoutRule | undefined): string {
  const comm = rule?.commission ? ` · commissioni il ${rule.commission.day} del mese dopo` : "";
  if (!rule || rule.mode === "arrival") return "Alla data di arrivo" + comm;
  if (rule.mode === "checkout") return (rule.days ? `${rule.days} giorni dopo il check-out` : "Al check-out") + comm;
  if (rule.mode === "weekly") return `Bonifico settimanale · ${WEEKDAY_LABELS[rule.weekday ?? 4].toLowerCase()}` + comm;
  return `Bonifico mensile · il ${rule.monthDay ?? 1} del mese dopo` + comm;
}
