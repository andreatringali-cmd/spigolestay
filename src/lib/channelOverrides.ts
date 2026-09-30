// Personalizzazioni per canale, decise dall'utente in Canali → dettaglio canale:
//  - colore: sovrascrive la variabile CSS --ch-<canale> (tema), usata ovunque nell'app per
//    colorare le prenotazioni di quel canale (barre calendario, grafici, chip...).
//  - commissione predefinita (%): usata da commissionPctOf (src/lib/booking.ts) quando una
//    prenotazione non ha una commissione esatta né una % propria — invece del valore fisso
//    in CHANNELS, che resta il default finché l'utente non lo personalizza.
// Impostazioni locali (sincronizzate come le altre chiavi "spigolestay:" — vedi authsync.tsx),
// non toccano nulla su Channex: sono solo una preferenza di visualizzazione/calcolo di Xenora.
import { CHANNELS, type Channel } from "./types";

const COLOR_KEY = "spigolestay:canali:colors";
const COMMISSION_KEY = "spigolestay:canali:commission";

function readMap(key: string): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function writeMap(key: string, m: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(m)); } catch {}
}

export function loadChannelColor(channel: Channel): string | undefined {
  const v = readMap(COLOR_KEY)[channel];
  return typeof v === "string" && v ? v : undefined;
}
export function loadChannelCommissionPct(channel: Channel): number | undefined {
  const v = readMap(COMMISSION_KEY)[channel];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
export const CHANNEL_COLORS_EVENT = "spigolestay:channelcolors";
export function saveChannelColor(channel: Channel, hex: string) {
  const m = readMap(COLOR_KEY); m[channel] = hex; writeMap(COLOR_KEY, m);
  try { window.dispatchEvent(new Event(CHANNEL_COLORS_EVENT)); } catch {}
}
export function saveChannelCommissionPct(channel: Channel, pct: number) {
  const m = readMap(COMMISSION_KEY); m[channel] = pct; writeMap(COMMISSION_KEY, m);
}

// Applica i colori salvati come proprietà inline sull'elemento passato (il div con la classe
// "dark" di ThemeProvider, non <html>): un inline style vince SEMPRE sulla regola ".dark{...}"
// per la stessa variabile quando è sullo stesso elemento, mentre un override su <html> verrebbe
// silenziosamente sovrascritto dalla regola del tema scuro applicata più in basso nell'albero.
export function applyChannelColorOverrides(target: HTMLElement) {
  if (typeof window === "undefined") return;
  const m = readMap(COLOR_KEY);
  (Object.keys(CHANNELS) as Channel[]).forEach((ch) => {
    const hex = m[ch];
    if (typeof hex === "string" && hex) target.style.setProperty(CHANNELS[ch].cssVar, hex);
  });
}
