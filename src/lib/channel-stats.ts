// Statistiche per canale per la pagina Canali: prenotazioni, notti, lordo, commissioni, netto e quota sui ricavi.
// Si contano le prenotazioni NON annullate (e non i blocchi "fuori servizio") il cui ARRIVO cade nel periodo scelto.
// Lordo, commissioni e netto usano le stesse formule dell'elenco Prenotazioni (lib/booking.ts): i numeri tornano ovunque.
import type { Channel } from "@/lib/types";
import { lordoOf, commissionOf, nettoOf } from "@/lib/booking";
import { otaGroupName } from "@/lib/channel-name";

export type StatsPeriod = "last30" | "next30" | "year";
export const PERIOD_LABEL: Record<StatsPeriod, string> = { last30: "Ultimi 30 giorni", next30: "Prossimi 30 giorni", year: "Anno in corso" };

type StatBooking = Parameters<typeof lordoOf>[0] & { status: string; checkIn: string; checkOut: string; channel: Channel; structureId?: string; otaName?: string };

const addDaysISO = (iso: string, n: number): string => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nightsBetween = (a: string, b: string): number => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));

/** Intervallo [from, to) sulle date di ARRIVO. `today` è un ISO yyyy-mm-dd. */
export function periodRange(p: StatsPeriod, today: string): { from: string; to: string } {
  if (p === "next30") return { from: today, to: addDaysISO(today, 30) };
  if (p === "year") return { from: `${today.slice(0, 4)}-01-01`, to: `${Number(today.slice(0, 4)) + 1}-01-01` };
  return { from: addDaysISO(today, -29), to: addDaysISO(today, 1) }; // ultimi 30 giorni, oggi compreso
}

export interface ChannelStat {
  channel: Channel;
  name?: string;       // nome del portale per il canale generico ("other"), per mostrare il logo giusto (bb.it…): solo se TUTTE le prenotazioni "other" sono dello stesso portale
  mixed?: boolean;     // "other" con portali diversi: nessun logo, etichetta generica (MIXED_OTA_LABEL)
  bookings: number;
  nights: number;
  gross: number;       // lordo (soggiorno + pulizia + extra, senza tassa di soggiorno)
  commission: number;  // commissioni totali trattenute (intermediazione + costo d'incasso)
  net: number;
  cancelled: number;   // prenotazioni annullate nello stesso periodo
  avgNight: number | null;       // lordo medio a notte
  commissionPct: number | null;  // commissioni ÷ lordo × 100
  shareGross: number;            // quota sul lordo totale del perimetro (0..100); se il lordo è 0, quota sulle prenotazioni
}
export interface ChannelStatsResult { rows: ChannelStat[]; totals: Omit<ChannelStat, "channel" | "shareGross"> }

const round2 = (n: number) => Math.round(n * 100) / 100;

export function channelStats(bookings: readonly StatBooking[], opts: { from: string; to: string; structureId?: string }): ChannelStatsResult {
  const by = new Map<Channel, ChannelStat>();
  const row = (ch: Channel): ChannelStat => {
    let r = by.get(ch);
    if (!r) { r = { channel: ch, bookings: 0, nights: 0, gross: 0, commission: 0, net: 0, cancelled: 0, avgNight: null, commissionPct: null, shareGross: 0 }; by.set(ch, r); }
    return r;
  };
  const otaNames: (string | undefined)[] = []; // otaName di OGNI prenotazione "other" del perimetro (il logo vale solo se sono tutte dello stesso portale)
  for (const b of bookings) {
    if (b.channel === "blocked") continue;
    if (opts.structureId && b.structureId !== opts.structureId) continue;
    if (!(b.checkIn >= opts.from && b.checkIn < opts.to)) continue;
    const r = row(b.channel);
    if (b.channel === "other") otaNames.push(b.otaName);
    if (b.status === "cancelled") { r.cancelled++; continue; }
    r.bookings++;
    r.nights += nightsBetween(b.checkIn, b.checkOut);
    r.gross += lordoOf(b);
    r.commission += commissionOf(b);
    r.net += nettoOf(b);
  }
  const oth = by.get("other");
  if (oth) { const g = otaGroupName(otaNames); oth.name = g.name; if (g.mixed) oth.mixed = true; }
  const rows = Array.from(by.values()).filter((r) => r.bookings > 0 || r.cancelled > 0);
  const totalGross = rows.reduce((a, r) => a + r.gross, 0);
  const totalBookings = rows.reduce((a, r) => a + r.bookings, 0);
  for (const r of rows) {
    r.gross = round2(r.gross); r.commission = round2(r.commission); r.net = round2(r.net);
    r.avgNight = r.nights > 0 && r.gross > 0 ? Math.round(r.gross / r.nights) : null;
    r.commissionPct = r.gross > 0 ? Math.round((r.commission / r.gross) * 1000) / 10 : null;
    r.shareGross = totalGross > 0 ? (r.gross / totalGross) * 100 : totalBookings > 0 ? (r.bookings / totalBookings) * 100 : 0;
  }
  rows.sort((a, b) => b.gross - a.gross || b.bookings - a.bookings);
  const t = rows.reduce((a, r) => ({ bookings: a.bookings + r.bookings, nights: a.nights + r.nights, gross: a.gross + r.gross, commission: a.commission + r.commission, net: a.net + r.net, cancelled: a.cancelled + r.cancelled }), { bookings: 0, nights: 0, gross: 0, commission: 0, net: 0, cancelled: 0 });
  return {
    rows,
    totals: {
      ...t, gross: round2(t.gross), commission: round2(t.commission), net: round2(t.net),
      avgNight: t.nights > 0 && t.gross > 0 ? Math.round(t.gross / t.nights) : null,
      commissionPct: t.gross > 0 ? Math.round((t.commission / t.gross) * 1000) / 10 : null,
    },
  };
}

// ---- Andamento mensile (grafico) ------------------------------------------------------------------------------------------------------------------
/** Mesi da `back` prima a `ahead` dopo quello di oggi, ciascuno come intervallo [from, to) sulle date di arrivo. */
export function monthRanges(today: string, back: number, ahead: number): { key: string; from: string; to: string; label: string; current: boolean; future: boolean }[] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  const iso = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10);
  const out = [];
  for (let k = -back; k <= ahead; k++) {
    const from = iso(y, m + k), to = iso(y, m + k + 1);
    out.push({
      key: from.slice(0, 7), from, to, current: k === 0, future: k > 0,
      label: new Date(`${from}T00:00:00Z`).toLocaleDateString("it-IT", { month: "short", timeZone: "UTC" }).replace(".", ""),
    });
  }
  return out;
}
