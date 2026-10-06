// Logica pura della Dashboard: movimenti del giorno, occupazione a 14 giorni, ricavi del mese,
// adempimenti ordinati per urgenza, "da controllare". Nessuna dipendenza da React né da altri moduli:
// i calcoli che servono dall'esterno (journey, tassa, saldo, ricavo a notte) arrivano come funzioni passate dal chiamante,
// così il modulo resta collaudabile con Node (tests/dashboard.test.ts).

export interface DBooking {
  id: string; guestId: string; structureId: string; unitId: string | null; channel: string; status: string;
  checkIn: string; checkOut: string; adults: number; children: number;
}
export interface DUnit { id: string; structureId: string; outOfService?: boolean }

const DAY = 86400000;
export const dayNum = (iso: string): number => { const [y, m, d] = iso.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
export const isoOfDayNum = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);
export const addDaysISO = (iso: string, n: number): string => isoOfDayNum(dayNum(iso) + n);
/** Giorno della settimana 0 = domenica … 6 = sabato. */
export const dowOf = (iso: string): number => new Date(dayNum(iso) * DAY).getUTCDay();
/** Differenza in giorni (a - b). */
export const diffDays = (a: string, b: string): number => dayNum(a) - dayNum(b);

/** Prenotazione "vera": non annullata, non no-show, non un blocco camera. */
export const isLive = (b: { status: string; channel: string }): boolean => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked";

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Saluto in base all'ora locale. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 13) return "Buongiorno";
  if (hour >= 13 && hour < 18) return "Buon pomeriggio";
  return "Buonasera";
}

// ---------- Movimenti del giorno ----------
export interface DaySplit<B> { arrivals: B[]; departures: B[]; inHouse: B[]; turnoverUnits: Set<string> }
/** Arrivi, partenze e soggiorni in corso (arrivati prima, partono dopo oggi). Turnover = stessa camera con partenza e arrivo oggi. */
export function splitDay<B extends DBooking>(live: B[], today: string): DaySplit<B> {
  const arrivals: B[] = [], departures: B[] = [], inHouse: B[] = [];
  for (const b of live) {
    if (b.checkIn === today) arrivals.push(b);
    if (b.checkOut === today) departures.push(b);
    if (b.checkIn < today && today < b.checkOut) inHouse.push(b);
  }
  const depUnits = new Set(departures.map((b) => b.unitId).filter((u): u is string => !!u));
  const turnoverUnits = new Set<string>();
  for (const b of arrivals) if (b.unitId && depUnits.has(b.unitId)) turnoverUnits.add(b.unitId);
  return { arrivals, departures, inHouse, turnoverUnits };
}

export interface SentencePart { text: string; tone?: "ok" | "err" | "focus" }
/** Frase-sintesi del giorno, a pezzi (i numeri portano il loro colore). */
export function todaySentence(arrivals: number, departures: number, stays: number): SentencePart[] {
  if (!arrivals && !departures && !stays) return [{ text: "Oggi nessun movimento e nessun ospite in casa: giornata tranquilla." }];
  if (!arrivals && !departures) return [{ text: "Nessun movimento oggi, " }, { text: `${stays} ${plural(stays, "soggiorno", "soggiorni")} in corso`, tone: "focus" }, { text: "." }];
  const parts: SentencePart[] = [{ text: "Oggi " }];
  const bits: SentencePart[][] = [];
  if (arrivals) bits.push([{ text: `${arrivals} ${plural(arrivals, "arrivo", "arrivi")}`, tone: "ok" }]);
  if (departures) bits.push([{ text: `${departures} ${plural(departures, "partenza", "partenze")}`, tone: "err" }]);
  if (stays) bits.push([{ text: `${stays} ${plural(stays, "soggiorno", "soggiorni")} in corso`, tone: "focus" }]);
  bits.forEach((bit, i) => {
    if (i > 0) parts.push({ text: i === bits.length - 1 ? " e " : ", " });
    parts.push(...bit);
  });
  parts.push({ text: "." });
  return parts;
}

/** Seconda frase: quante cose da sistemare. */
export function statusSentence(total: number, urgent: number): string {
  if (total <= 0) return "Tutto in regola: niente da sistemare.";
  const base = `${total} ${plural(total, "cosa", "cose")} da sistemare`;
  return urgent > 0 ? `${base}, ${urgent} ${plural(urgent, "urgente", "urgenti")}.` : `${base}.`;
}

// ---------- Occupazione a N giorni ----------
export interface DayCell { iso: string; dow: number; occupied: number; total: number; pct: number; arrivals: number; departures: number; stay: number; isToday: boolean }
/** Occupazione notte per notte da `start` per `days` giorni, con arrivi e partenze di ogni giorno. Una sola passata sulle prenotazioni. */
export function occupancyStrip<B extends DBooking>(live: B[], units: DUnit[], start: string, days: number, today: string = start): DayCell[] {
  const roomIds = new Set(units.filter((u) => !u.outOfService).map((u) => u.id));
  const total = roomIds.size;
  const s0 = dayNum(start);
  const stay = new Array<number>(days).fill(0), occ = new Array<number>(days).fill(0), arr = new Array<number>(days).fill(0), dep = new Array<number>(days).fill(0);
  for (const b of live) {
    if (b.unitId && !roomIds.has(b.unitId)) continue; // camera fuori servizio o non nello scope
    const ci = dayNum(b.checkIn) - s0, co = dayNum(b.checkOut) - s0;
    if (co < 0 || ci >= days) continue;
    if (ci >= 0 && ci < days) arr[ci]++;
    if (co >= 0 && co < days) dep[co]++;
    for (let i = Math.max(0, ci); i < Math.min(days, co); i++) occ[i]++;
    for (let i = Math.max(0, ci + 1); i < Math.min(days, co); i++) stay[i]++; // in casa: arrivato prima e ancora presente
  }
  return Array.from({ length: days }, (_, i) => {
    const iso = isoOfDayNum(s0 + i);
    const o = Math.min(occ[i], total);
    return { iso, dow: dowOf(iso), occupied: o, total, pct: total ? Math.round((o / total) * 100) : 0, arrivals: arr[i], departures: dep[i], stay: stay[i], isToday: iso === today };
  });
}

// ---------- Ricavi del mese ----------
export interface MonthStats { daily: number[]; total: number; earned: number; ahead: number; byChannel: { channel: string; revenue: number; count: number }[] }
/**
 * Ricavi per competenza (per notte) nell'intervallo [from, toExcl). `nightRev(b, iso)` dà il ricavo di quella notte.
 * earned = notti già vissute (prima di oggi), ahead = notti ancora da vivere ma già prenotate.
 */
export function monthStats<B extends DBooking>(live: B[], from: string, toExcl: string, today: string, nightRev: (b: B, iso: string) => number): MonthStats {
  const base = dayNum(from), n = dayNum(toExcl) - base;
  const daily = new Array<number>(Math.max(0, n)).fill(0);
  const ch = new Map<string, { revenue: number; count: number }>();
  let total = 0, earned = 0;
  const todayIdx = dayNum(today) - base;
  for (const b of live) {
    const s = Math.max(dayNum(b.checkIn), base), e = Math.min(dayNum(b.checkOut), base + n);
    if (e <= s) continue;
    let r = 0;
    for (let d = s; d < e; d++) { const v = nightRev(b, isoOfDayNum(d)) || 0; daily[d - base] += v; r += v; if (d - base < todayIdx) earned += v; }
    total += r;
    const c = ch.get(b.channel) ?? { revenue: 0, count: 0 };
    c.revenue += r; c.count++; ch.set(b.channel, c);
  }
  const byChannel = [...ch.entries()].map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.revenue - a.revenue);
  return { daily, total, earned, ahead: total - earned, byChannel };
}
/** Somma cumulata (per la sparkline). */
export const cumulative = (xs: number[]): number[] => { let a = 0; return xs.map((x) => (a += x)); };

// ---------- Adempimenti ----------
export interface StepLite { key: string; state: "done" | "todo" | "late" | "na" }
export type Tone = "err" | "warn";
export interface AdempimentoItem { key: string; short: string; one: string; many: string; count: number; tone: Tone; detail: string; amount?: number; href: string; bookingIds: string[] }
export interface AdempimentiInput<B extends DBooking> {
  bookings: B[];                                   // prenotazioni vere dello scope (la funzione filtra da sola le finestre utili)
  today: string;
  journeyFor: (b: B) => StepLite[] | null;
  schedinaOf: (b: B) => "none" | "da_validare" | "pronta" | "inviata";
  istatPending: (b: B) => boolean;
  taxOf: (b: B) => number;                         // tassa di soggiorno dovuta (0 se non applicabile o esente)
  balanceOf: (b: B) => number;                     // saldo ancora da incassare
  nameOf: (b: B) => string;
  questuraErrors?: number;                         // invii Alloggiati falliti di recente
}

const DEF: Record<string, { short: string; one: string; many: string; href: string; order: number }> = {
  checkin: { short: "Check-in", one: "check-in online da completare", many: "check-in online da completare", href: "/adempimenti", order: 1 },
  questura: { short: "Questura", one: "schedina Questura da inviare", many: "schedine Questura da inviare", href: "/alloggiati-web", order: 2 },
  qerr: { short: "Errori Questura", one: "invio alla Questura in errore", many: "invii alla Questura in errore", href: "/alloggiati-web", order: 3 },
  pay: { short: "Saldi", one: "saldo da incassare", many: "saldi da incassare", href: "/pagamenti", order: 4 },
  tax: { short: "Tassa", one: "tassa di soggiorno da incassare", many: "tassa di soggiorno da incassare", href: "/tassa-soggiorno", order: 5 },
  istat: { short: "ISTAT", one: "movimento ISTAT da inviare", many: "movimenti ISTAT da inviare", href: "/istat", order: 6 },
  guide: { short: "Guida", one: "guida ospiti da inviare", many: "guide ospiti da inviare", href: "/messaggi", order: 7 },
};

/** Nomi brevi per il dettaglio: "Rossi, Bianchi e altri 2". */
export function namesLine(names: string[], max = 2): string {
  const uniq = [...new Set(names.filter(Boolean))];
  if (uniq.length <= max) return uniq.join(", ");
  return `${uniq.slice(0, max).join(", ")} e altri ${uniq.length - max}`;
}

/**
 * Cose da fare davvero, ordinate per urgenza (prima i ritardi, poi le scadenze di oggi, a parità l'ordine di importanza).
 * Regole: check-in = arrivi di oggi e ospiti già in casa; schedina Questura = arrivati da meno di 3 giorni, più quelle già pronte o da correggere;
 * ISTAT = solo movimenti già pronti da inviare; tassa = partenze di oggi e degli ultimi 14 giorni; saldi = ospiti in casa o in partenza oggi; guida = arrivi di oggi e domani.
 */
export function buildAdempimenti<B extends DBooking>(inp: AdempimentiInput<B>): AdempimentoItem[] {
  const { today } = inp;
  type Acc = { list: { b: B; tone: Tone }[]; amount: number };
  const acc: Record<string, Acc> = {};
  const add = (key: string, b: B, tone: Tone, amount = 0) => { (acc[key] ??= { list: [], amount: 0 }).list.push({ b, tone }); acc[key].amount += amount; };
  for (const b of inp.bookings) {
    const diff = diffDays(b.checkIn, today);     // <0 già arrivato, 0 oggi, >0 futuro
    const dep = diffDays(b.checkOut, today);     // <0 già partito, 0 oggi
    const steps = diff <= 2 && dep >= -14 ? inp.journeyFor(b) : null;
    const step = (k: string) => steps?.find((s) => s.key === k);
    // Check-in online mancante
    if (diff <= 0 && dep >= 0) { const s = step("checkin"); if (s && (s.state === "late" || s.state === "todo")) add("checkin", b, diff < 0 ? "err" : "warn"); }
    // Schedina Questura: pronte o da correggere (qualsiasi data) + arrivati da meno di 3 giorni senza schedina
    if (diff <= 0) {
      const sc = inp.schedinaOf(b);
      if (sc === "da_validare") add("questura", b, "err");
      else if (sc === "pronta") add("questura", b, diff < 0 ? "err" : "warn");
      else if (sc === "none" && diff >= -3) add("questura", b, diff < 0 ? "err" : "warn");
    }
    // ISTAT già pronto
    if (diff <= 0 && inp.istatPending(b)) add("istat", b, "warn");
    // Tassa di soggiorno
    if (dep <= 0 && dep >= -14) { const s = step("tax"); const t = inp.taxOf(b); if (s && t > 0 && (s.state === "todo" || s.state === "late")) add("tax", b, dep < 0 ? "err" : "warn", t); }
    // Saldo aperto: in casa o in partenza oggi
    if (diff <= 0 && dep >= 0) { const bal = inp.balanceOf(b); if (bal > 0.005) add("pay", b, dep === 0 ? "err" : "warn", bal); }
    // Guida ospiti per arrivi di oggi e domani
    if (diff === 0 || diff === 1) { const s = step("guide"); if (s && (s.state === "todo" || s.state === "late")) add("guide", b, s.state === "late" ? "err" : "warn"); }
  }
  const out: AdempimentoItem[] = [];
  for (const [key, a] of Object.entries(acc)) {
    const d = DEF[key];
    const tone: Tone = a.list.some((x) => x.tone === "err") ? "err" : "warn";
    const sorted = [...a.list].sort((x, y) => x.b.checkIn.localeCompare(y.b.checkIn));
    out.push({
      key, short: d.short, one: d.one, many: d.many, count: a.list.length, tone, amount: a.amount > 0 ? a.amount : undefined, href: d.href,
      detail: namesLine(sorted.map((x) => inp.nameOf(x.b))), bookingIds: sorted.map((x) => x.b.id),
    });
  }
  if ((inp.questuraErrors ?? 0) > 0) out.push({ key: "qerr", ...pick(DEF.qerr), count: inp.questuraErrors!, tone: "err", detail: "Controlla l'esito degli invii degli ultimi 30 giorni", href: DEF.qerr.href, bookingIds: [] });
  const toneRank = (t: Tone) => (t === "err" ? 0 : 1);
  return out.sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || DEF[a.key].order - DEF[b.key].order);
}
const pick = (d: { short: string; one: string; many: string }) => ({ short: d.short, one: d.one, many: d.many });

/** Totali per lo stato complessivo: quante voci, quante urgenti. */
export function adempimentiStato(items: AdempimentoItem[]): { total: number; urgent: number; tone: "ok" | "warn" | "err" } {
  const total = items.reduce((a, i) => a + i.count, 0);
  const urgent = items.filter((i) => i.tone === "err").reduce((a, i) => a + i.count, 0);
  return { total, urgent, tone: total === 0 ? "ok" : urgent > 0 ? "err" : "warn" };
}

// ---------- Da controllare ----------
/** Arrivi nei prossimi `horizon` giorni (oggi compreso) senza camera assegnata. */
export function unassignedArrivals<B extends DBooking>(live: B[], today: string, horizon = 7): { count: number; nearest: number | null } {
  let count = 0, nearest: number | null = null;
  for (const b of live) {
    if (b.unitId) continue;
    const d = diffDays(b.checkIn, today);
    if (d < 0 || d > horizon) continue;
    count++; if (nearest === null || d < nearest) nearest = d;
  }
  return { count, nearest };
}

export interface ControlliInput {
  unassigned: { count: number; nearest: number | null };
  contacts: { count: number; urgent: number };
  invii: { label: string; href: string }[];
  pulse: { channel: string; label: string; level: "err" | "warn"; headline: string; detail: string }[];
  oos: number;
}
export interface ControlloItem { key: string; tone: "err" | "warn" | "dim"; count: number; label: string; detail?: string; href: string; channel?: string }
export function buildControlli(i: ControlliInput): ControlloItem[] {
  const out: ControlloItem[] = [];
  i.invii.forEach((x, k) => out.push({ key: `invio${k}`, tone: "err", count: 1, label: x.label, href: x.href }));
  if (i.unassigned.count > 0) {
    const n = i.unassigned.nearest;
    out.push({
      key: "senzacamera", tone: n !== null && n <= 2 ? "err" : "warn", count: i.unassigned.count,
      label: plural(i.unassigned.count, "arrivo senza camera assegnata", "arrivi senza camera assegnata"),
      detail: n === 0 ? "il primo è oggi" : n === 1 ? "il primo è domani" : n !== null ? `il primo tra ${n} giorni` : undefined, href: "/prenotazioni",
    });
  }
  if (i.contacts.count > 0) {
    out.push({
      key: "contatti", tone: i.contacts.urgent > 0 ? "err" : "warn", count: i.contacts.count,
      label: plural(i.contacts.count, "ospite in arrivo con un contatto da correggere", "ospiti in arrivo con un contatto da correggere"),
      detail: i.contacts.urgent > 0 ? `${i.contacts.urgent} ${plural(i.contacts.urgent, "arriva", "arrivano")} entro 10 giorni` : "i messaggi automatici non partirebbero", href: "/ospiti",
    });
  }
  for (const p of i.pulse) out.push({ key: `canale-${p.channel}`, tone: p.level, count: 1, label: `${p.label}: ${p.headline.toLowerCase()}`, detail: p.detail, href: "/canali", channel: p.channel });
  if (i.oos > 0) out.push({ key: "oos", tone: "dim", count: i.oos, label: plural(i.oos, "camera fuori servizio", "camere fuori servizio"), href: "/camere" });
  return out;
}

// ---------- Salute degli adempimenti ----------
const HEALTH_KEYS = ["checkin", "pay", "tax", "alloggiati"];
/**
 * Percentuale di passaggi già fatti per chi è in struttura, arriva o parte oggi (check-in, pagamento, schedina; la tassa solo per chi parte oggi).
 * Nessun passaggio rilevante = 100%.
 */
export function adempimentiHealth<B extends DBooking>(bookings: B[], today: string, journeyFor: (b: B) => StepLite[] | null): { done: number; total: number; pct: number } {
  let done = 0, total = 0;
  for (const b of bookings) {
    if (b.checkIn > today || b.checkOut < today) continue;
    const steps = journeyFor(b);
    if (!steps) continue;
    for (const st of steps) {
      if (!HEALTH_KEYS.includes(st.key) || st.state === "na") continue;
      if (st.key === "tax" && b.checkOut !== today) continue;
      total++; if (st.state === "done") done++;
    }
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 100 };
}

// ---------- Pickup: prenotazioni ricevute per giorno ----------
export interface PickupStats { days: { iso: string; count: number }[]; total: number; last7: number; prev7: number; deltaPct: number | null }
/** Prenotazioni ricevute (data bookedOn) negli ultimi `days` giorni, oggi compreso. Confronto: ultimi 7 giorni contro i 7 precedenti. */
export function pickupDaily(bookings: { bookedOn?: string }[], today: string, days = 30): PickupStats {
  const t0 = dayNum(today);
  const counts = new Array<number>(days).fill(0);
  for (const b of bookings) {
    if (!b.bookedOn || !/^\d{4}-\d{2}-\d{2}/.test(b.bookedOn)) continue;
    const i = dayNum(b.bookedOn.slice(0, 10)) - (t0 - days + 1);
    if (i >= 0 && i < days) counts[i]++;
  }
  const sum = (a: number, b: number) => counts.slice(a, b).reduce((x, y) => x + y, 0);
  const last7 = sum(days - 7, days), prev7 = sum(days - 14, days - 7);
  return {
    days: counts.map((count, i) => ({ iso: isoOfDayNum(t0 - days + 1 + i), count })),
    total: sum(0, days), last7, prev7, deltaPct: prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null,
  };
}

// ---------- Istogrammi: anticipo di prenotazione e durata ----------
export interface Histo { labels: string[]; counts: number[]; total: number; avg: number | null }
/** Conta i valori in fasce chiuse da un limite superiore (incluso). L'ultima fascia raccoglie tutto il resto. */
export function histogram(values: number[], upper: number[], labels: string[]): Histo {
  const counts = new Array<number>(upper.length).fill(0);
  let sum = 0;
  for (const v of values) { let i = upper.findIndex((u) => v <= u); if (i < 0) i = upper.length - 1; counts[i]++; sum += v; }
  return { labels, counts, total: values.length, avg: values.length ? sum / values.length : null };
}
export const LEAD_UPPER = [1, 7, 14, 30, 60, Infinity];
export const LEAD_LABELS = ["0-1", "2-7", "8-14", "15-30", "31-60", "61+"];
export const STAY_UPPER = [1, 2, 3, 4, 6, Infinity];
export const STAY_LABELS = ["1", "2", "3", "4", "5-6", "7+"];
/** Giorni tra la prenotazione e l'arrivo (solo se bookedOn è valido e non successivo all'arrivo). */
export function leadDays(b: { bookedOn?: string; checkIn: string }): number | null {
  if (!b.bookedOn || !/^\d{4}-\d{2}-\d{2}/.test(b.bookedOn)) return null;
  const d = diffDays(b.checkIn, b.bookedOn.slice(0, 10));
  return d >= 0 ? d : null;
}
export const stayNights = (b: { checkIn: string; checkOut: string }): number => Math.max(1, diffDays(b.checkOut, b.checkIn));

// ---------- ADR e RevPAR ----------
/** Serie giornaliere: ADR = ricavo / camere occupate, RevPAR = ricavo / camere disponibili. Medie pesate sul periodo. */
export function rateSeries(rev: number[], occ: number[], rooms: number): { adr: number[]; revpar: number[]; adrAvg: number; revparAvg: number } {
  const adr = rev.map((r, i) => (occ[i] > 0 ? r / occ[i] : 0));
  const revpar = rev.map((r) => (rooms > 0 ? r / rooms : 0));
  const R = rev.reduce((a, b) => a + b, 0), O = occ.reduce((a, b) => a + b, 0);
  return { adr, revpar, adrAvg: O > 0 ? R / O : 0, revparAvg: rooms > 0 && rev.length ? R / (rooms * rev.length) : 0 };
}

// ---------- Provenienza ----------
const NAME_TO_CC: Record<string, string> = {
  italia: "IT", italy: "IT", germania: "DE", germany: "DE", francia: "FR", france: "FR", spagna: "ES", spain: "ES", "regno unito": "GB", inghilterra: "GB", uk: "GB", "united kingdom": "GB",
  "stati uniti": "US", usa: "US", olanda: "NL", "paesi bassi": "NL", netherlands: "NL", polonia: "PL", svizzera: "CH", austria: "AT", belgio: "BE", svezia: "SE", portogallo: "PT", irlanda: "IE",
  danimarca: "DK", norvegia: "NO", finlandia: "FI", grecia: "GR", canada: "CA", australia: "AU", brasile: "BR", giappone: "JP", cina: "CN",
};
export const COUNTRY_NAMES: Record<string, string> = {
  IT: "Italia", DE: "Germania", FR: "Francia", ES: "Spagna", GB: "Regno Unito", US: "Stati Uniti", NL: "Paesi Bassi", PL: "Polonia", CH: "Svizzera", AT: "Austria", BE: "Belgio", SE: "Svezia",
  PT: "Portogallo", IE: "Irlanda", DK: "Danimarca", NO: "Norvegia", FI: "Finlandia", GR: "Grecia", CA: "Canada", AU: "Australia", BR: "Brasile", JP: "Giappone", CN: "Cina",
};
/** Codice Paese a 2 lettere da un codice o da un nome; null se non indicato. */
export function normCountry(raw?: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase() === "UK" ? "GB" : t.toUpperCase();
  return NAME_TO_CC[t.toLowerCase()] ?? null;
}
export interface CountryRow { code: string; name: string; count: number; share: number }
/** I primi N Paesi per numero di prenotazioni (quota sul totale con Paese noto). */
export function topCountries(countries: (string | undefined)[], n = 5): { rows: CountryRow[]; known: number } {
  const m = new Map<string, number>();
  let known = 0;
  for (const c of countries) { const cc = normCountry(c); if (!cc) continue; known++; m.set(cc, (m.get(cc) ?? 0) + 1); }
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
    .map(([code, count]) => ({ code, name: COUNTRY_NAMES[code] ?? code, count, share: known ? Math.round((count / known) * 100) : 0 }));
  return { rows, known };
}
