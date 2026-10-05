// "Polso" dei canali: allarme visibilità.
// I portali (Booking.com, Airbnb, Expedia…) non dicono a un gestionale come ti hanno posizionato né se hai perso il livello Genius.
// Quello che si vede davvero è il FLUSSO: se da un canale arrivano molte meno prenotazioni del solito, o nessuna da giorni, qualcosa è cambiato
// (posizione nei risultati, prezzi fuori mercato, camere chiuse, canale scollegato, sincronizzazione ferma). Questa funzione lo individua
// dai dati che Xenora ha già, senza chiamate a nessuno, e lo dice in parole semplici. Non inventa cause: segnala il sintomo.

export type PulseLevel = "ok" | "info" | "warn" | "err";

export interface PulseBooking { channel: string; bookedOn?: string }
export interface PulseInput {
  bookings: PulseBooking[];
  today: string;                                   // "AAAA-MM-GG" locale
  connected?: Record<string, boolean>;             // stato del collegamento per canale (se noto)
  lastSyncHours?: Record<string, number | undefined>; // ore dall'ultima sincronizzazione per canale (se nota)
  labels?: Record<string, string>;                 // nome leggibile del canale
}
export interface ChannelPulse {
  channel: string; label: string; level: PulseLevel; headline: string; detail: string;
  recent: number;            // prenotazioni arrivate negli ultimi 7 giorni
  baselineWeekly: number;    // media settimanale delle 4 settimane precedenti
  deltaPct: number | null;   // variazione % rispetto alla media (null se non calcolabile)
  daysSinceLast: number | null;
}

const DAY = 86400000;
const daysAgo = (today: string, iso: string) => Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(iso + "T00:00:00Z")) / DAY);
const fmt = (n: number) => (Math.round(n * 10) / 10).toString().replace(".", ",");
const ORDER: Record<PulseLevel, number> = { err: 0, warn: 1, info: 2, ok: 3 };

export function channelPulse(input: PulseInput): ChannelPulse[] {
  const { bookings, today, connected = {}, lastSyncHours = {}, labels = {} } = input;
  const byChannel = new Map<string, number[]>(); // giorni trascorsi da ogni prenotazione ricevuta
  for (const b of bookings) {
    if (!b.channel || b.channel === "blocked" || !b.bookedOn || !/^\d{4}-\d{2}-\d{2}$/.test(b.bookedOn)) continue;
    const d = daysAgo(today, b.bookedOn);
    if (d < 0 || d > 120) continue;
    const arr = byChannel.get(b.channel); if (arr) arr.push(d); else byChannel.set(b.channel, [d]);
  }
  const channels = new Set<string>([...byChannel.keys(), ...Object.keys(connected).filter((k) => connected[k])]);
  const out: ChannelPulse[] = [];
  for (const c of channels) {
    const ds = byChannel.get(c) ?? [];
    const label = labels[c] ?? c;
    const recent = ds.filter((d) => d < 7).length;
    const base = ds.filter((d) => d >= 7 && d < 35).length;
    const baselineWeekly = base / 4;
    const total90 = ds.filter((d) => d < 90).length;
    const last = ds.length ? Math.min(...ds) : null;
    const avgGap = total90 > 0 ? 90 / total90 : null;
    const deltaPct = baselineWeekly >= 1 ? Math.round((recent / baselineWeekly - 1) * 100) : null;
    const mk = (level: PulseLevel, headline: string, detail: string): ChannelPulse => ({ channel: c, label, level, headline, detail, recent, baselineWeekly, deltaPct, daysSinceLast: last });

    // 1) canale scollegato (se si sa): è la causa più semplice e più grave
    if (connected[c] === false && (ds.length > 0)) { out.push(mk("err", "Non collegato", `${label} non risulta collegato: non arrivano prenotazioni e prezzi e disponibilità non si aggiornano.`)); continue; }
    // 2) sincronizzazione ferma
    const sh = lastSyncHours[c];
    if (connected[c] !== false && typeof sh === "number" && sh > 48) { out.push(mk("warn", "Sincronizzazione ferma", `L'ultimo aggiornamento con ${label} risale a ${Math.round(sh)} ore fa: prezzi e disponibilità potrebbero non essere allineati.`)); continue; }
    // 3) calo marcato rispetto al solito (serve una media di almeno 3 a settimana, altrimenti i numeri sono troppo piccoli per dire qualcosa)
    if (baselineWeekly >= 3 && recent <= baselineWeekly * 0.5) {
      const heavy = recent <= baselineWeekly * 0.3;
      out.push(mk(heavy ? "err" : "warn", `In calo ${deltaPct}%`, `${recent} ${recent === 1 ? "prenotazione" : "prenotazioni"} negli ultimi 7 giorni contro una media di ${fmt(baselineWeekly)} a settimana. Controlla posizione, prezzi e camere in vendita su ${label}.`));
      continue;
    }
    // 4) silenzio: abitualmente arrivavano prenotazioni e ora nulla da troppo tempo
    if (total90 >= 6 && last !== null && avgGap !== null && last > Math.max(10, avgGap * 2)) {
      out.push(mk("warn", `Nessuna prenotazione da ${last} giorni`, `Di solito ne arriva una ogni ${fmt(avgGap)} giorni circa. Verifica che il canale sia attivo e che le camere siano in vendita.`));
      continue;
    }
    // 5) crescita
    if (baselineWeekly >= 3 && recent >= baselineWeekly * 1.5) { out.push(mk("info", `In crescita +${deltaPct}%`, `${recent} prenotazioni negli ultimi 7 giorni contro una media di ${fmt(baselineWeekly)} a settimana.`)); continue; }
    // 6) tutto regolare (solo se ci sono dati sufficienti per dirlo)
    if (total90 >= 3) { out.push(mk("ok", "Regolare", `${recent} ${recent === 1 ? "prenotazione" : "prenotazioni"} negli ultimi 7 giorni${baselineWeekly >= 1 ? `, in linea con la media di ${fmt(baselineWeekly)} a settimana` : ""}.`)); continue; }
    out.push(mk("info", "Pochi dati", "Ancora poche prenotazioni per valutare l'andamento di questo canale."));
  }
  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.label.localeCompare(b.label));
}
