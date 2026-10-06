// Invii automatici di una prenotazione: per ogni passaggio (check-in, guida, pagamento, recensione, schedina) dice se c'è un invio
// programmato e QUANDO parte ("invio previsto alle 10:00", "invio tra 25 minuti"). Funzione pura, nessuna chiamata di rete.
// Gli orari sono quelli REALI dei cron (vercel.json, in UTC), convertiti nell'ora italiana: l'orario scritto nel modello è indicativo,
// perché i cron girano una volta al giorno. Se l'invio automatico non è attivo (interruttore lato server) lo dice, invece di promettere un invio.

export type AutoTrigger = "manual" | "before_arrival" | "on_arrival" | "after_arrival" | "on_checkout" | "after_checkout";
export interface AutoTpl {
  id: string; name?: string; trigger: AutoTrigger; days: number; active: boolean;
  texts?: Record<string, string>; structureIds?: string[];
}
export interface AutoCtx {
  now: number;                              // ms (Date.now())
  templates: AutoTpl[];                     // modelli & automazioni dell'account
  messagesLive: boolean | null;             // invio automatico dei messaggi attivo sul server? (null = non ancora noto)
  alloggiatiLive?: boolean | null;          // invio reale alla Questura attivo?
  alloggiatiAuto?: Record<string, boolean>; // per struttura: invio automatico giornaliero acceso
}
export interface AutoLine { text: string; tone: "info" | "warn" }
export type AutoStepKey = "checkin" | "guide" | "pay" | "review" | "alloggiati";

/** Ora UTC dei cron (vedi vercel.json): promemoria check-in 07:00, messaggi automatici 08:00, schedine Questura 21:00. */
export const CRON_HOUR_UTC = { checkinReminder: 7, messages: 8, alloggiati: 21 } as const;

const ymdAdd = (iso: string, d: number) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
/** Istante (ms) in cui il cron delle `hourUtc` gira nel giorno `iso`. */
export const instantAt = (iso: string, hourUtc: number) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d, hourUtc, 0, 0); };

const romeFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function romeParts(ms: number) {
  const p = romeFmt.formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const hh = g("hour") === "24" ? "00" : g("hour");
  return { ymd: `${g("year")}-${g("month")}-${g("day")}`, hm: `${hh}:${g("minute")}` };
}

/** Giorno (Y-M-D) in cui un modello parte rispetto alle date del soggiorno. Stesso calcolo del cron dei messaggi. */
export function slotDateOf(t: Pick<AutoTpl, "trigger" | "days">, checkIn: string, checkOut: string): string | null {
  const n = Math.abs(t.days || 0);
  switch (t.trigger) {
    case "before_arrival": return ymdAdd(checkIn, -n);
    case "on_arrival": return checkIn;
    case "after_arrival": return ymdAdd(checkIn, n);
    case "on_checkout": return checkOut;
    case "after_checkout": return ymdAdd(checkOut, n);
    default: return null;
  }
}

/** A quale passaggio appartiene un modello: lo dicono i segnaposto che usa (link check-in, link guida, saldo) o il suo scopo (recensione). */
export function stepOfTemplate(t: AutoTpl): AutoStepKey | null {
  const text = Object.values(t.texts ?? {}).join("\n");
  if (/\{link_checkin\}/i.test(text)) return "checkin";
  if (/\{link_guida\}/i.test(text)) return "guide";
  if (/\{saldo\}/i.test(text)) return "pay";
  if ((t.trigger === "after_checkout" || t.trigger === "on_checkout") && /recension|review|feedback|bewertung|avis|reseña/i.test(`${t.name ?? ""}\n${text}`)) return "review";
  return null;
}

/** "tra 25 minuti" · "previsto alle 10:00" · "previsto domani alle 10:00" · "previsto il 7/10 alle 10:00"; null se l'istante è già passato. */
export function whenText(ts: number, now: number): string | null {
  const mins = Math.ceil((ts - now) / 60000);
  if (mins <= 0) return null;
  if (mins <= 90) return `tra ${mins} ${mins === 1 ? "minuto" : "minuti"}`;
  const t = romeParts(ts), n = romeParts(now);
  if (t.ymd === n.ymd) return `previsto alle ${t.hm}`;
  if (t.ymd === ymdAdd(n.ymd, 1)) return `previsto domani alle ${t.hm}`;
  const [, m, d] = t.ymd.split("-");
  return `previsto il ${+d}/${+m} alle ${t.hm}`;
}

export interface AutoBooking { structureId: string; checkIn: string; checkOut: string }
export interface AutoGuest { email?: string; phone?: string }

/**
 * Riga "invio automatico" per un passaggio ancora da fare, o null se non c'è nulla di vero da dire.
 * `wasSent`: è già partito un messaggio (a mano o dai solleciti): non si scrive "Non inviato".
 */
export function autoLineFor(key: AutoStepKey, b: AutoBooking, g: AutoGuest | undefined, a: AutoCtx, o: { today: string; wasSent?: boolean; schedina?: "da_validare" | "pronta" | "inviata" | "none"; checkinDone?: boolean }): AutoLine | null {
  const email = (g?.email ?? "").trim(), phone = (g?.phone ?? "").trim();
  const prefix = o.wasSent ? "" : "Non inviato · ";

  if (key === "alloggiati") {
    const sc = o.schedina ?? "none";
    if (!a.alloggiatiAuto?.[b.structureId] || !a.alloggiatiLive || sc === "inviata" || sc === "da_validare") return null;
    if (!(sc === "pronta" || o.checkinDone)) return null;
    if (b.checkOut < o.today) return null;
    let day = b.checkIn > o.today ? b.checkIn : o.today;
    let ts = instantAt(day, CRON_HOUR_UTC.alloggiati);
    if (ts <= a.now) { day = ymdAdd(day, 1); ts = instantAt(day, CRON_HOUR_UTC.alloggiati); }
    const w = whenText(ts, a.now);
    return w ? { text: `Invio automatico alla Questura: ${w.replace(/^previsto /, "")}`, tone: "info" } : null;
  }

  type Cand = { ts: number };
  const cands: Cand[] = [];
  let paused = false;

  // Promemoria check-in: parte da solo (senza interruttori) alle 07:00 UTC del giorno prima dell'arrivo, solo per email.
  if (key === "checkin" && email) {
    const ts = instantAt(ymdAdd(b.checkIn, -1), CRON_HOUR_UTC.checkinReminder);
    if (ts > a.now) cands.push({ ts });
  }
  // Modelli automatici: partono dal cron dei messaggi, solo se l'invio automatico è attivo e l'ospite ha email o telefono.
  if (email || phone) {
    for (const t of a.templates) {
      if (!t.active || t.trigger === "manual" || stepOfTemplate(t) !== key) continue;
      if (t.structureIds?.length && !t.structureIds.includes(b.structureId)) continue;
      const slot = slotDateOf(t, b.checkIn, b.checkOut);
      if (!slot) continue;
      const ts = instantAt(slot, CRON_HOUR_UTC.messages);
      if (ts <= a.now) continue;
      if (a.messagesLive === true) cands.push({ ts });
      else if (a.messagesLive === false && slot <= ymdAdd(o.today, 3)) paused = true;
    }
  }
  if (cands.length) {
    const ts = Math.min(...cands.map((c) => c.ts));
    const w = whenText(ts, a.now);
    if (w) return { text: `${prefix}invio ${w}`, tone: "info" };
  }
  if (key === "checkin" && !email && b.checkIn >= o.today && b.checkIn <= ymdAdd(o.today, 3)) {
    return { text: "Nessuna email dell'ospite: il promemoria automatico non può partire", tone: "warn" };
  }
  if (paused) return { text: `${prefix}invio automatico in pausa`, tone: "warn" };
  return null;
}
