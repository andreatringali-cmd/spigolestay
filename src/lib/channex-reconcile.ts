// ============================================================
//  Riconciliazione di prenotazioni GIÀ importate con la revision attuale di Channex (cifre esatte): logica pura + accesso a Channex iniettato,
//  così la route /api/channex/reconcile è sottile e tutto si prova con un Channex finto. Nessuna scrittura: restituisce solo le cifre.
//  Le cifre si ricavano con le STESSE funzioni dell'import (channex-inbound.ts): readRevisionGuestData (totale con i centesimi), ota_commission/commission,
//  parsePaymentCharge (costo d'incasso nelle note) e splitCommission (ripartizione tra le camere).
// ============================================================
import type { ChxRevision } from "@/lib/channex";
import { readRevisionGuestData } from "@/lib/channex-guestdata";
import { splitCommission } from "@/lib/commission-split";
import { parsePaymentCharge } from "@/lib/payment-fee";
import { channelFromOta } from "@/lib/channex-channel";
import type { ReconcileResult, ReconcileRoom } from "@/lib/booking-heal";

const num = (v: unknown, d = 0) => { const n = Number(v); return isNaN(n) ? d : n; };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Commissione OTA dell'intera prenotazione, con i centesimi; undefined se Channex non la manda per questa revision (campo assente o 0). */
export function revisionCommission(r: { ota_commission?: unknown; commission?: unknown }): number | undefined {
  const c = num(r.ota_commission ?? r.commission, NaN);
  return Number.isFinite(c) && c > 0 ? round2(c) : undefined;
}

/**
 * Cifre esatte di una revision, una voce per camera (come l'import): totale con i centesimi, quota di commissione e di costo d'incasso.
 * Per Booking.com ed Expedia. Su Expedia (importo già netto) la commissione è un dato informativo (trattenute già tolte dal totale): chi applica le cifre la scrive in otaDeductions.
 */
export function summarizeRevision(r: ChxRevision): ReconcileResult {
  const channel = channelFromOta(r.ota_name);
  const id = String(r.booking_id || r.id);
  if (channel !== "booking" && channel !== "expedia") return { id, ok: false, status: r.status, error: "canale_non_supportato" };
  const roomsArr = r.rooms && r.rooms.length ? r.rooms : [{}];
  const raw = r as unknown as Record<string, unknown>;
  const roomTotals = roomsArr.map((room, i) => readRevisionGuestData(raw, room as unknown as Record<string, unknown>, i === 0).total ?? 0);
  const commission = revisionCommission(r);
  const commShares = splitCommission(commission, roomTotals);
  const feeAll = parsePaymentCharge(String((r as unknown as { notes?: unknown }).notes ?? ""));
  const feeShares = splitCommission(feeAll, roomTotals);
  const rooms: ReconcileRoom[] = roomsArr.map((room, i) => ({
    checkIn: String(room.checkin_date || r.arrival_date || ""),
    checkOut: String(room.checkout_date || r.departure_date || ""),
    ...(roomTotals[i] > 0 ? { total: roomTotals[i] } : {}),
    ...(commShares[i] != null ? { commissionAmount: commShares[i] } : {}),
    ...(feeShares[i] != null ? { paymentFee: feeShares[i] } : {}),
  }));
  const total = round2(roomTotals.reduce((a, x) => a + x, 0));
  return {
    id, ok: true, status: r.status, rooms,
    ...(total > 0 ? { total } : {}),
    ...(commission != null ? { commissionAmount: commission } : {}),
    ...(feeAll != null ? { paymentFee: feeAll } : {}),
  };
}

export interface ReconcileDeps {
  /** Legge la revision attuale di una prenotazione Channex (in produzione: getLatestRevisionOfBooking). */
  fetchLatest(bookingId: string): Promise<{ ok: boolean; status: number; error?: string; revision?: ChxRevision }>;
  /** Id delle property Channex dell'utente (allowedChannexProperties): una prenotazione di un'altra property non si legge. */
  allowedProps: Set<string>;
  now(): number;
}
export interface ReconcileOptions { maxIds?: number; budgetMs?: number; maxConsecutiveErrors?: number }
export interface ReconcileOutcome { results: ReconcileResult[]; stopped?: "tempo" | "errori"; skipped: string[] }

export const BOOKING_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Per ogni id legge la revision attuale e ne ricava le cifre. A blocchi piccoli con tetti: al massimo `maxIds` richieste (default 8), entro `budgetMs`
 * (default 20 s) e ci si ferma dopo `maxConsecutiveErrors` errori di fila (default 2, o subito su 429). Gli id non letti vanno in `skipped`.
 */
export async function reconcileBookings(ids: string[], deps: ReconcileDeps, opts: ReconcileOptions = {}): Promise<ReconcileOutcome> {
  const maxIds = opts.maxIds ?? 8, budgetMs = opts.budgetMs ?? 20000, maxErr = opts.maxConsecutiveErrors ?? 2;
  const clean = Array.from(new Set(ids.filter((x) => typeof x === "string" && BOOKING_ID_RE.test(x))));
  const todo = clean.slice(0, maxIds);
  const out: ReconcileOutcome = { results: [], skipped: clean.slice(maxIds) };
  const t0 = deps.now();
  let errStreak = 0;
  for (let i = 0; i < todo.length; i++) {
    const id = todo[i];
    if (deps.now() - t0 > budgetMs) { out.stopped = "tempo"; out.skipped.push(...todo.slice(i)); break; }
    const res = await deps.fetchLatest(id);
    if (!res.ok || !res.revision) {
      out.results.push({ id, ok: false, error: res.error ? String(res.error).slice(0, 200) : `errore Channex (${res.status})` });
      errStreak++;
      if (res.status === 429 || errStreak >= maxErr) { out.stopped = "errori"; out.skipped.push(...todo.slice(i + 1)); break; }
      continue;
    }
    errStreak = 0;
    const rev = res.revision;
    // La revision deve essere DAVVERO di questa prenotazione e di una property dell'utente (l'account Channex è condiviso fra tutti i tenant).
    if (rev.booking_id && rev.booking_id !== id) { out.results.push({ id, ok: false, error: "revision_non_corrispondente" }); continue; }
    if (!rev.property_id || !deps.allowedProps.has(rev.property_id)) { out.results.push({ id, ok: false, error: "non_autorizzato" }); continue; }
    out.results.push({ ...summarizeRevision(rev), id });
  }
  return out;
}
