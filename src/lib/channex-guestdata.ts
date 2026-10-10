// ============================================================
//  Channex → Xenora: lettura PURA dei dati dell'ospite da una booking revision
//  (richieste speciali, orario di arrivo, età dei bambini, tipo di pagamento,
//  penali di cancellazione, importi con i centesimi). Nessun import con alias né
//  accesso a rete/DB: così è testabile con `node --test`.
//
//  Campi usati, TUTTI confermati dalla documentazione ufficiale Channex
//  (https://docs.channex.io/api-v.1-documentation/bookings-collection):
//   revision:  notes, arrival_hour ("HH:MM", può essere null), payment_collect
//              ("property" | "ota" | null), payment_type ("credit_card" | "bank_transfer" | null)
//   rooms[]:   occupancy.ages (lista età, presente se children > 0, può essere null),
//              amount ("Total Booking Room amount"), days (prezzi per notte),
//              meta (JSON libero per OTA): meta.cancel_penalties[] {amount, currency, from}
//              (esempi Booking.com), meta.meal_plan, meta.payment_instruction,
//              meta.free_text, meta.bed_preferences, meta.smoking_preferences (esempi Expedia/Booking.com)
//  NON esistono nello schema: culle/lettini, un campo "cancel_policy" dedicato, un flag
//  "Expedia Collect" esplicito → non vengono inventati (vedi commenti in channex-inbound.ts).
// ============================================================

type Json = Record<string, unknown>;

export interface OtaCancelPenalty { from: string; amount: number; currency?: string }

// Dati grezzi dell'OTA tenuti sulla prenotazione (Booking.otaInfo). Servono anche a capire, alla
// revision successiva, se il valore dell'OTA è CAMBIATO rispetto a quello già importato.
export interface OtaInfo {
  notes?: string;                         // richieste del cliente (revision.notes + meta.free_text, ripulite)
  arrivalHour?: string;                   // revision.arrival_hour "HH:MM"
  paymentCollect?: "property" | "ota";    // chi incassa: struttura o OTA (revision.payment_collect)
  paymentType?: "credit_card" | "bank_transfer"; // revision.payment_type
  paymentInstruction?: string;            // room.meta.payment_instruction (Expedia)
  cancelPenalties?: OtaCancelPenalty[];   // room.meta.cancel_penalties (Booking.com): penale che scatta da "from"
  mealPlan?: string;                      // room.meta.meal_plan
  bedPreferences?: string;                // room.meta.bed_preferences (Expedia)
  smokingPreferences?: string;            // room.meta.smoking_preferences
}

export interface RevisionGuestData {
  otaInfo?: OtaInfo;
  guestRequests?: string;   // testo richieste per la scheda (note + free_text, senza righe finanziarie Airbnb)
  arrivalTime?: string;     // "HH:MM"
  childAges?: number[];
  total?: number;           // € con i centesimi, solo se l'importo esatto è noto
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const toNum = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const round2 = (n: number) => Math.round(n * 100) / 100;

// Somma i prezzi per notte ai CENTESIMI (somma in centesimi interi: niente errori di virgola mobile).
export function sumDaysExact(days?: Record<string, string | number> | null): number {
  if (!days || typeof days !== "object") return 0;
  let cents = 0;
  for (const v of Object.values(days)) { const n = toNum(v); if (Number.isFinite(n)) cents += Math.round(n * 100); }
  return cents / 100;
}

// Totale della camera con i centesimi: somma dei giorni → importo della camera (room.amount) →
// importo della prenotazione (solo per la prima camera). Ritorna 0 se nulla è noto.
export function roomTotalExact(room: Json | undefined, revisionAmount: unknown, isFirstRoom: boolean): number {
  const fromDays = sumDaysExact(room?.days as Record<string, string> | undefined);
  if (fromDays > 0) return round2(fromDays);
  const ra = toNum(room?.amount);
  if (Number.isFinite(ra) && ra > 0) return round2(ra);
  const rv = toNum(revisionAmount);
  return isFirstRoom && Number.isFinite(rv) && rv > 0 ? round2(rv) : 0;
}

// Airbnb mette nelle note righe finanziarie ("Listing Base Price: 300.00", "Total Paid Amount: ...",
// ecc., vedi esempio nella doc): non sono richieste dell'ospite e non vanno mostrate come tali.
const FINANCIAL_NOTE_LINE = /^\s*(listing\s+[a-z ]+|total paid amount|transient occupancy tax paid amount|occupancy tax amount paid to host)\s*:\s*-?[\d.,]+\s*$/i;
export function cleanOtaNotes(notes: unknown): string | undefined {
  const s = str(notes);
  if (!s) return undefined;
  const kept = s.split(/\r?\n/).filter((l) => !FINANCIAL_NOTE_LINE.test(l)).join("\n").trim();
  return kept || undefined;
}

function parsePenalties(v: unknown): OtaCancelPenalty[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: OtaCancelPenalty[] = [];
  for (const p of v) {
    if (!isObj(p)) continue;
    const amount = toNum(p.amount); const from = str(p.from);
    if (!Number.isFinite(amount) || !from) continue;
    out.push({ from, amount: round2(amount), ...(str(p.currency) ? { currency: str(p.currency) } : {}) });
  }
  out.sort((a, b) => a.from.localeCompare(b.from));
  return out.length ? out : undefined;
}

// Testo leggibile della politica di cancellazione dalle penali (Booking.com). Una penale a 0 è
// "gratis fino al"; la prima penale > 0 è quella che scatta. Ritorna undefined se non ci sono penali.
export function describeCancelPenalties(p?: OtaCancelPenalty[]): string | undefined {
  if (!p || !p.length) return undefined;
  const day = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return y && m && d ? `${d}/${m}/${y}` : iso; };
  const money = (x: OtaCancelPenalty) => `${x.amount.toFixed(2).replace(".", ",")}${x.currency ? " " + x.currency : ""}`;
  const firstCharge = p.find((x) => x.amount > 0);
  if (!firstCharge) return "Cancellazione senza penale";
  const freeBefore = p.some((x) => x.amount === 0 && x.from < firstCharge.from);
  return freeBefore
    ? `Cancellazione gratuita fino al ${day(firstCharge.from)}; poi penale di ${money(firstCharge)}`
    : `Penale di ${money(firstCharge)} dal ${day(firstCharge.from)}`;
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d/;

// Legge i dati ospite da UNA revision e UNA sua camera. `room` può essere undefined (revision senza camere).
export function readRevisionGuestData(rev: Json, room: Json | undefined, isFirstRoom = true): RevisionGuestData {
  const meta = isObj(room?.meta) ? (room!.meta as Json) : {};
  const notes = cleanOtaNotes(rev.notes);
  const freeText = cleanOtaNotes(meta.free_text);

  const hour = str(rev.arrival_hour);
  const arrivalHour = hour && HHMM.test(hour) ? hour.slice(0, 5).padStart(5, "0") : undefined;

  const pc = str(rev.payment_collect)?.toLowerCase();
  const pt = str(rev.payment_type)?.toLowerCase();
  // Richieste: note del cliente + free_text della camera se diverso (Expedia ripete spesso lo stesso testo).
  const reqParts = [notes, freeText && freeText !== notes && !(notes ?? "").includes(freeText) ? freeText : undefined].filter(Boolean) as string[];
  const requests = reqParts.join("\n");
  const info: OtaInfo = {
    ...(requests ? { notes: requests } : {}),
    ...(arrivalHour ? { arrivalHour } : {}),
    ...(pc === "property" || pc === "ota" ? { paymentCollect: pc } : {}),
    ...(pt === "credit_card" || pt === "bank_transfer" ? { paymentType: pt } : {}),
    ...(str(meta.payment_instruction) ? { paymentInstruction: str(meta.payment_instruction) } : {}),
    ...(parsePenalties(meta.cancel_penalties) ? { cancelPenalties: parsePenalties(meta.cancel_penalties) } : {}),
    ...(str(meta.meal_plan) ? { mealPlan: str(meta.meal_plan) } : {}),
    ...(str(meta.bed_preferences) ? { bedPreferences: str(meta.bed_preferences) } : {}),
    ...(str(meta.smoking_preferences) ? { smokingPreferences: str(meta.smoking_preferences) } : {}),
  };

  const occ = isObj(room?.occupancy) ? (room!.occupancy as Json) : {};
  const ages = Array.isArray(occ.ages) ? (occ.ages as unknown[]).map(toNum).filter((n) => Number.isFinite(n) && n >= 0 && n <= 17) : [];

  const total = roomTotalExact(room, rev.amount, isFirstRoom);
  return {
    ...(Object.keys(info).length ? { otaInfo: info } : {}),
    ...(requests ? { guestRequests: requests } : {}),
    ...(arrivalHour ? { arrivalTime: arrivalHour } : {}),
    ...(ages.length ? { childAges: ages } : {}),
    ...(total > 0 ? { total } : {}),
  };
}

// Valori ospite/gestore già presenti sulla riga sostituita: il dato dell'OTA li sovrascrive SOLO se
// è cambiato rispetto a quello che avevamo importato (altrimenti vale quanto scritto dall'ospite al
// check-in online o dal gestore). Ritorna i campi da applicare sopra quelli riportati (CARRY).
export function mergeOtaOverCarried(
  fresh: RevisionGuestData,
  carried: { guestRequests?: unknown; arrivalTime?: unknown; childAges?: unknown },
  prevInfo?: OtaInfo,
): { guestRequests?: string; arrivalTime?: string; childAges?: number[] } {
  const out: { guestRequests?: string; arrivalTime?: string; childAges?: number[] } = {};
  const cReq = str(carried.guestRequests);
  const cArr = str(carried.arrivalTime);
  // Richieste: se nulla è stato riportato o il testo riportato era quello (vecchio) dell'OTA → aggiorna.
  if (fresh.guestRequests) {
    const prevOta = prevInfo?.notes;
    if (!cReq || cReq === prevOta || (prevOta && cReq === prevOta.trim())) out.guestRequests = fresh.guestRequests;
    else if (!cReq.includes(fresh.guestRequests)) out.guestRequests = `${cReq}\n${fresh.guestRequests}`; // l'ospite ha scritto altro: si affianca
  }
  // Orario di arrivo: l'OTA vince se non c'era nulla o se l'ora dell'OTA è cambiata.
  if (fresh.arrivalTime) {
    if (!cArr || cArr === "Non lo so" || (prevInfo && fresh.arrivalTime !== prevInfo.arrivalHour)) out.arrivalTime = fresh.arrivalTime;
  }
  // Età bambini: l'OTA è la fonte (quando le manda); in assenza resta quanto riportato.
  if (fresh.childAges?.length) out.childAges = fresh.childAges;
  return out;
}
