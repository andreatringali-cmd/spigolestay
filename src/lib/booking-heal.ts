// ============================================================
//  Allineamento AUTOMATICO delle prenotazioni già presenti (nessun pulsante, nessun incolla).
//  Funzioni PURE (nessun accesso a rete/DB/store): producono "patch" che il componente BookingHealer applica in silenzio.
//   a) totali con i centesimi: la prenotazione Booking importata da Channex ha il totale arrotondato all'euro (346,00) ma l'incassato ha i
//      centesimi giusti (346,60): si porta il totale all'incassato, solo se la differenza è sotto 1 €.
//   b) doppioni Octorate/Channex: la stessa prenotazione importata sia da Octorate (extId "octorate:…") sia da Channex (extId "channex:…").
//      Non si cancella nulla: si porta sulla riga Channex (quella viva) ciò che esiste solo sull'Octorate e la riga Octorate si segna
//      annullata come duplicato (sparisce da calendario, totali e Cassa ma resta recuperabile).
//   c) commissioni esatte lette da Channex: `needsChannexCheck` sceglie quali prenotazioni rileggere, `reconcilePatches` trasforma la risposta
//      della route /api/channex/reconcile in patch.
// ============================================================
import type { Booking } from "@/lib/types";

export interface BookingPatch { id: string; patch: Partial<Booking> }

const round2 = (n: number) => Math.round(n * 100) / 100;
const isActive = (b: { status?: string; channel?: string }) => b.status !== "cancelled" && b.channel !== "blocked";
/** Prenotazioni Channex di cui si possono rileggere le cifre esatte: Booking.com ed Expedia. */
const isReconcilable = (b: Booking) => (b.channel === "booking" || b.channel === "expedia") && typeof b.extId === "string" && b.extId.startsWith("channex:");
const isChannexBooking = (b: Booking) => b.channel === "booking" && typeof b.extId === "string" && b.extId.startsWith("channex:");

/** Id Channex (senza il prefisso "channex:") di una prenotazione importata da Channex. */
export function channexIdOf(b: { extId?: string }): string | null {
  const x = String(b.extId ?? "");
  return x.startsWith("channex:") && x.length > 8 ? x.slice(8) : null;
}

// ── a) totali con i centesimi ───────────────────────────────────────────────────────────────────────
/**
 * Booking importate da Channex, non annullate, con totale intero e incassato con i centesimi a meno di 1 € di distanza:
 * `total = paid` (l'incassato è la cifra esatta pagata dall'ospite a Booking). Mai se l'incassato è 0 o più distante di 1 €.
 */
export function healRoundedTotals(bookings: Booking[]): BookingPatch[] {
  const out: BookingPatch[] = [];
  for (const b of bookings) {
    if (!isChannexBooking(b) || !isActive(b)) continue;
    const total = Number(b.total), paid = Number(b.paid);
    if (!Number.isFinite(total) || !Number.isFinite(paid) || total <= 0 || paid <= 0) continue;
    if (!Number.isInteger(total)) continue;
    const exact = round2(paid);
    if (exact === total || Math.abs(exact - total) >= 1) continue;
    out.push({ id: b.id, patch: { total: exact } });
  }
  return out;
}

/**
 * Prenotazioni importate da Channex (QUALSIASI canale: Expedia, Airbnb…) con il totale arrotondato all'euro (381) ma i prezzi per notte con i centesimi
 * (5 × 76,28 = 381,40): il totale diventa la somma delle notti. Solo se il totale è intero, la somma è entro 1 € e i prezzi coprono tutte le notti.
 */
export function healTotalsFromNights(bookings: Booking[]): BookingPatch[] {
  const out: BookingPatch[] = [];
  for (const b of bookings) {
    if (!isActive(b) || channexIdOf(b) === null) continue;
    const total = Number(b.total);
    const rates = b.nightlyRates;
    if (!rates || !Number.isFinite(total) || total <= 0 || !Number.isInteger(total)) continue;
    const nightsN = Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86400000);
    const vals = Object.entries(rates).filter(([d]) => d >= b.checkIn && d < b.checkOut).map(([, v]) => Number(v));
    if (nightsN <= 0 || vals.length !== nightsN || vals.some((v) => !Number.isFinite(v) || v <= 0)) continue;
    const sum = round2(vals.reduce((a, v) => a + v, 0));
    if (sum === total || Math.abs(sum - total) >= 1) continue;
    out.push({ id: b.id, patch: { total: sum } });
  }
  return out;
}

// ── b) doppioni Octorate / Channex ──────────────────────────────────────────────────────────────────
/** Campi che esistono solo su una riga e che, se vuoti sulla riga viva, si portano dalla gemella. */
export const TWIN_FILL_FIELDS = [
  "cleaningFee", "cityTaxExempt", "cityTaxPaid", "cityTaxInPaid", "depositPaid", "parking", "webCheckin", "arrivalTime", "docPhotoFront", "docPhotoBack", "signature",
  "invoiceNo", "extraGuests", "primaryGuest", "extras", "upsellOffers", "invoiceRequest", "guestRequests", "color", "movedFrom", "reviewRequestedAt",
  "reviewRequestChannel", "childAges", "cribs", "paymentMethod", "paymentFee", "privacyConsentAt", "privacyConsentBy",
] as const;

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || v === false || v === 0 || (Array.isArray(v) && v.length === 0);

/** Nota "utile" di una riga Octorate: senza l'intestazione automatica "Importato da Octorate" (o CSV). */
export function usefulOctorateNote(note: unknown): string | undefined {
  const s = String(note ?? "").replace(/^\s*Importato da (Octorate|CSV)\s*(·\s*)?/i, "").trim();
  return s || undefined;
}

/**
 * Cosa portare dalla riga gemella `twin` (Octorate) sulla riga viva `target` (Channex): incassato (il maggiore, mai la somma: è lo stesso pagamento),
 * commissione esatta, costo d'incasso e tutti i campi ancora vuoti. Non sovrascrive mai un valore già presente sulla riga viva.
 */
export function twinFillPatch(target: Record<string, unknown>, twin: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const tp = Number(twin.paid), cp = Number(target.paid);
  if (Number.isFinite(tp) && tp > 0 && !(Number.isFinite(cp) && cp >= tp)) out.paid = round2(tp);
  const tc = Number(twin.commissionAmount), cc = Number(target.commissionAmount);
  if (Number.isFinite(tc) && tc > 0 && !(Number.isFinite(cc) && cc > 0)) out.commissionAmount = round2(tc);
  else if (!(Number.isFinite(cc) && cc > 0) && isEmpty(target.commissionPct) && !isEmpty(twin.commissionPct)) out.commissionPct = twin.commissionPct;
  for (const k of TWIN_FILL_FIELDS) if (isEmpty(target[k]) && !isEmpty(twin[k])) out[k] = twin[k];
  return out;
}

export const DUPLICATE_NOTE_PREFIX = "Duplicato (Octorate) di ";
/** Come si segna la riga Octorate duplicata: annullata (non cancellata), con nota che lo spiega. */
export function duplicatePatch(octorate: { note?: string }, code: string): Partial<Booking> {
  const prev = String(octorate.note ?? "");
  if (prev.startsWith(DUPLICATE_NOTE_PREFIX)) return { status: "cancelled", note: prev };
  return { status: "cancelled", note: `${DUPLICATE_NOTE_PREFIX}${code}: unito alla prenotazione Channex${prev ? " · " + prev : ""}`.slice(0, 600) };
}

/** Righe Octorate ATTIVE che sono la stessa prenotazione di una revision Channex (stessa struttura, canale, numero prenotazione e date). Ritorna gli indici. */
export function findOctorateTwins(
  bookings: { status?: unknown; channel?: unknown; structureId?: unknown; extId?: unknown; code?: unknown; checkIn?: unknown; checkOut?: unknown }[],
  q: { structureId: string; code: string; channel: string; ranges: { ci: string; co: string }[] },
): number[] {
  const code = String(q.code ?? "").trim();
  if (!code) return [];
  const out: number[] = [];
  bookings.forEach((b, i) => {
    if (b.status === "cancelled" || b.channel === "blocked" || b.structureId !== q.structureId || b.channel !== q.channel) return;
    if (!String(b.extId ?? "").startsWith("octorate:") || String(b.code ?? "").trim() !== code) return;
    if (q.ranges.some((r) => r.ci === b.checkIn && r.co === b.checkOut)) out.push(i);
  });
  return out;
}

const occupiedByOthers = (all: Booking[], unitId: string, ci: string, co: string, exclude: Set<string>) =>
  all.some((x) => x.unitId === unitId && isActive(x) && !exclude.has(x.id) && x.checkIn < co && x.checkOut > ci);

/**
 * Coppie Octorate/Channex della stessa prenotazione → patch: la riga Channex riceve i dati che esistono solo sull'Octorate, la riga Octorate
 * viene annullata come duplicato. Prudenza: nei casi ambigui NON si agisce affatto (numero di righe diverso, tipologie non abbinabili,
 * camere diverse e occupate da altre prenotazioni). Idempotente: dopo l'applicazione le righe Octorate sono annullate e non si ripresentano.
 */
export function healDuplicates(bookings: Booking[]): BookingPatch[] {
  const groups = new Map<string, { c: Booking[]; o: Booking[] }>();
  for (const b of bookings) {
    if (!isActive(b) || b.channel === "direct") continue;
    const code = String(b.code ?? "").trim();
    if (!code) continue;
    const ex = String(b.extId ?? "");
    const kind = ex.startsWith("channex:") ? "c" : ex.startsWith("octorate:") ? "o" : null;
    if (!kind) continue;
    const key = [b.structureId, b.channel, code, b.checkIn, b.checkOut].join("|");
    const g = groups.get(key) ?? { c: [], o: [] };
    g[kind].push(b); groups.set(key, g);
  }

  const out: BookingPatch[] = [];
  for (const [key, g] of groups) {
    if (!g.c.length || !g.o.length) continue;
    if (g.c.length !== g.o.length) continue; // ambiguo: quante camere sono davvero?
    const code = key.split("|")[2];
    const groupIds = new Set([...g.c, ...g.o].map((x) => x.id));

    // Abbinamento riga Channex ↔ riga Octorate: stessa tipologia (meglio se anche stessa camera). Con una sola coppia si abbina direttamente.
    const pairs: { c: Booking; o: Booking }[] = [];
    const pool = [...g.o];
    let ambiguous = false;
    if (g.c.length === 1) pairs.push({ c: g.c[0], o: g.o[0] });
    else {
      for (const c of g.c) {
        let i = pool.findIndex((o) => o.roomTypeId === c.roomTypeId && !!c.unitId && o.unitId === c.unitId);
        if (i < 0) i = pool.findIndex((o) => o.roomTypeId === c.roomTypeId);
        if (i < 0) { ambiguous = true; break; }
        pairs.push({ c, o: pool.splice(i, 1)[0] });
      }
    }
    if (ambiguous) continue;

    const groupPatches: BookingPatch[] = [];
    let skipGroup = false;
    for (const { c, o } of pairs) {
      // Camere diverse assegnate alle due righe: se una delle due è già occupata da altre prenotazioni attive nelle stesse date, non si capisce quale sia giusta.
      if (c.unitId && o.unitId && c.unitId !== o.unitId
        && (occupiedByOthers(bookings, c.unitId, c.checkIn, c.checkOut, groupIds) || occupiedByOthers(bookings, o.unitId, o.checkIn, o.checkOut, groupIds))) { skipGroup = true; break; }

      const cp: Record<string, unknown> = twinFillPatch(c as unknown as Record<string, unknown>, o as unknown as Record<string, unknown>);
      // Totale: quello Octorate vale solo se ha i centesimi giusti e la riga Channex ha un totale mancante o arrotondato a meno di 1 €.
      const ot = Number(o.total), ct = Number(c.total);
      if (Number.isFinite(ot) && ot > 0 && (!(Number.isFinite(ct) && ct > 0) || (Number.isInteger(ct) && !Number.isInteger(ot) && Math.abs(ot - ct) < 1))) cp.total = round2(ot);
      // Camera: solo se la riga Channex non ne ha una, la tipologia coincide e la camera non è presa da altre prenotazioni.
      if (!c.unitId && o.unitId && o.roomTypeId === c.roomTypeId && !occupiedByOthers(bookings, o.unitId, c.checkIn, c.checkOut, groupIds)) cp.unitId = o.unitId;
      // Note utili dell'Octorate (non l'intestazione automatica).
      const useful = usefulOctorateNote(o.note);
      if (useful && !String(c.note ?? "").includes(useful)) cp.note = `${c.note ? c.note + " · " : ""}${useful}`.slice(0, 600);

      if (Object.keys(cp).length) groupPatches.push({ id: c.id, patch: cp as Partial<Booking> });
      groupPatches.push({ id: o.id, patch: duplicatePatch(o, code) });
    }
    if (!skipGroup) out.push(...groupPatches);
  }
  return out;
}

// ── c) commissioni e totali esatti da Channex ───────────────────────────────────────────────────────
/** Risposta della route /api/channex/reconcile per una prenotazione (una voce per camera, nell'ordine delle camere della revision). */
export interface ReconcileRoom { checkIn: string; checkOut: string; total?: number; commissionAmount?: number; paymentFee?: number }
export interface ReconcileResult {
  id: string; ok: boolean; status?: string; error?: string;
  total?: number; commissionAmount?: number; paymentFee?: number; rooms?: ReconcileRoom[];
}

export const CHECK_WINDOW_DAYS = 30;
export const CHECK_RETRY_MS = 24 * 60 * 60 * 1000;

const isoMinusDays = (iso: string, days: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };

/**
 * Id Channex delle prenotazioni Booking da rileggere: check-out da 30 giorni fa in avanti, con commissione esatta mancante oppure totale intero
 * (possibile arrotondamento) senza incassato che lo confermi. Non quelle già controllate nelle ultime 24 ore (`checked`: id → timestamp).
 * Prima quelle senza commissione, poi per check-out più vicino. `max` limita il numero.
 */
export function needsChannexCheck(bookings: Booking[], todayIso: string, checked: Record<string, number>, nowMs: number, max = 40): string[] {
  const from = isoMinusDays(todayIso, CHECK_WINDOW_DAYS);
  const cand = new Map<string, { noComm: boolean; co: string }>();
  for (const b of bookings) {
    if (!isReconcilable(b) || !isActive(b) || (b.netTotal && b.channel !== "expedia") || b.checkOut < from) continue;
    const id = channexIdOf(b); if (!id) continue;
    if (nowMs - (checked[id] ?? 0) < CHECK_RETRY_MS) continue;
    const curComm = Number(b.otaDeductions ?? b.commissionAmount);
    const noComm = !(curComm > 0);
    const intComm = b.channel === "expedia" && curComm > 0 && Number.isInteger(curComm); // Expedia importata con commissione tonda: forse arrotondata, si rilegge
    const intTotal = Number.isFinite(Number(b.total)) && Number(b.total) > 0 && Number.isInteger(Number(b.total));
    if (!noComm && !intTotal && !intComm) continue;
    const prev = cand.get(id);
    cand.set(id, { noComm: (prev?.noComm ?? false) || noComm, co: prev && prev.co < b.checkOut ? prev.co : b.checkOut });
  }
  return [...cand.entries()]
    .sort((a, b) => (a[1].noComm === b[1].noComm ? a[1].co.localeCompare(b[1].co) : a[1].noComm ? -1 : 1))
    .slice(0, max).map(([id]) => id);
}

/**
 * Patch dalle risposte di Channex. Si scrive solo ciò che manca o è arrotondato:
 *  - commissione esatta e costo d'incasso se la riga non li ha;
 *  - totale con i centesimi se la riga ha un totale mancante o intero a meno di 1 € da quello di Channex.
 * Una prenotazione con righe che non combaciano con le camere della revision (numero o date) non viene toccata. Le revision annullate non si toccano.
 */
export function reconcilePatches(bookings: Booking[], results: ReconcileResult[]): BookingPatch[] {
  const out: BookingPatch[] = [];
  for (const r of results) {
    if (!r.ok || !r.rooms?.length || String(r.status ?? "").toLowerCase() === "cancelled") continue;
    const rows = bookings.filter((b) => isReconcilable(b) && isActive(b) && channexIdOf(b) === r.id);
    if (!rows.length || rows.length !== r.rooms.length) continue;
    if (!rows.every((row, i) => row.checkIn === r.rooms![i].checkIn && row.checkOut === r.rooms![i].checkOut)) continue;
    rows.forEach((row, i) => {
      const room = r.rooms![i];
      const patch: Partial<Booking> = {};
      if (room.commissionAmount != null && room.commissionAmount > 0) {
        const exact = round2(room.commissionAmount);
        const net = row.channel === "expedia" && row.netTotal !== false; // importo già netto: la commissione è un dato informativo (otaDeductions)
        const cur = Number(net ? (row.otaDeductions ?? row.commissionAmount) : row.commissionAmount);
        const missing = !(cur > 0);
        const rounded = cur > 0 && Number.isInteger(cur) && !Number.isInteger(exact) && Math.abs(exact - cur) < 1;
        if (missing || rounded) {
          if (net) { patch.otaDeductions = exact; if (Number(row.commissionAmount) > 0) patch.commissionAmount = exact; }
          else patch.commissionAmount = exact;
        }
      }
      if (!(Number(row.paymentFee) > 0) && room.paymentFee != null && room.paymentFee > 0) patch.paymentFee = round2(room.paymentFee);
      const rt = room.total, ct = Number(row.total);
      if (rt != null && rt > 0 && rt !== ct && (!(ct > 0) || (Number.isInteger(ct) && Math.abs(rt - ct) < 1))) patch.total = round2(rt);
      if (Object.keys(patch).length) out.push({ id: row.id, patch });
    });
  }
  return out;
}

// ── utilità per il componente e i test ──────────────────────────────────────────────────────────────
/** Unisce più elenchi di patch: per lo stesso id i campi si sommano (l'ultimo elenco vince sui campi uguali). */
export function mergePatches(...lists: BookingPatch[][]): BookingPatch[] {
  const by = new Map<string, Partial<Booking>>();
  for (const l of lists) for (const p of l) by.set(p.id, { ...(by.get(p.id) ?? {}), ...p.patch });
  return [...by.entries()].map(([id, patch]) => ({ id, patch }));
}
/** Copia dell'elenco con le patch applicate (non modifica l'originale). */
export function applyPatches(bookings: Booking[], patches: BookingPatch[]): Booking[] {
  const by = new Map(patches.map((p) => [p.id, p.patch]));
  return bookings.map((b) => { const p = by.get(b.id); return p ? { ...b, ...p } : b; });
}
