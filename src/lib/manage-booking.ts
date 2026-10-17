import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysYmd, ymdRome } from "./dates-rome";

// Helper server-side per la GESTIONE prenotazione da parte dell'OSPITE (pagina /gestisci).
// Una prenotazione può vivere in app_state (struttura personale) oppure in org_state
// (struttura condivisa in società). Qui la si ritrova ovunque sia e si restituisce il
// contesto necessario a mostrarla, annullarla e (se previsto) rimborsarla.

export const DATA_KEY = "spigolestay:data:v1";

type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const parseBlob = (data: unknown): Json => {
  const blob = ((data ?? {}) as Record<string, string>) || {};
  try { return JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { return {}; }
};

export interface BookingStore {
  table: "app_state" | "org_state";
  keyCol: "user_id" | "org_id";
  keyVal: string;
  blob: Record<string, string>;   // riga completa (tutte le chiavi di sync)
  data: Json;                      // contenuto DATA_KEY già parsificato
  rev: number | null;
  booking: Json;
  bookingIndex: number;
  structure: Json | null;
  roomType: Json | null;
  guest: Json | null;
  ownerId: string;
  sid: string;
}

// Legge una riga (app_state/org_state) e cerca la prenotazione per id.
async function scan(admin: SupabaseClient, table: "app_state" | "org_state", keyCol: "user_id" | "org_id", keyVal: string, bookingId: string): Promise<BookingStore | null> {
  const { data: row } = await admin.from(table).select("data, rev").eq(keyCol, keyVal).maybeSingle();
  if (!row) return null;
  const blob = (((row as { data?: unknown }).data ?? {}) as Record<string, string>) || {};
  const data = parseBlob((row as { data?: unknown }).data);
  const bookings = arr(data.bookings);
  const idx = bookings.findIndex((b) => (b as { id?: string }).id === bookingId);
  if (idx < 0) return null;
  const booking = bookings[idx];
  const sid = String((booking as { structureId?: string }).structureId || "");
  const structure = arr(data.structures).find((s) => (s as { id?: string }).id === sid) || null;
  const rtId = String((booking as { roomTypeId?: string }).roomTypeId || "");
  const roomType = arr(data.roomTypes).find((r) => (r as { id?: string }).id === rtId) || null;
  const gId = String((booking as { guestId?: string }).guestId || "");
  const guest = arr(data.guests).find((g) => (g as { id?: string }).id === gId) || null;
  return {
    table, keyCol, keyVal, blob, data,
    rev: typeof (row as { rev?: number }).rev === "number" ? (row as { rev: number }).rev : null,
    booking, bookingIndex: idx, structure, roomType, guest, ownerId: "", sid,
  };
}

// Ritrova la prenotazione a partire dallo slug del sito pubblico + id prenotazione.
// Cerca prima nelle organizzazioni condivise del proprietario (fonte di verità per le
// strutture in società), poi nel personale.
export async function findBookingStore(admin: SupabaseClient, slug: string, bookingId: string): Promise<BookingStore | null> {
  if (!slug || !bookingId) return null;
  const { data: site } = await admin.from("public_sites").select("user_id, structure_id").eq("slug", slug).maybeSingle();
  const ownerId = String((site as { user_id?: string } | null)?.user_id || "");
  if (!ownerId) return null;

  // 1) org_state delle organizzazioni di cui il proprietario è membro
  const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
  for (const m of arr(ms)) {
    const orgId = String((m as { org_id?: string }).org_id || "");
    if (!orgId) continue;
    const hit = await scan(admin, "org_state", "org_id", orgId, bookingId);
    if (hit) { hit.ownerId = ownerId; return hit; }
  }
  // 2) personale
  const hit = await scan(admin, "app_state", "user_id", ownerId, bookingId);
  if (hit) { hit.ownerId = ownerId; return hit; }
  return null;
}

// Applica una mutazione al contenuto dello store e scrive con lucchetto sul rev.
// mutate riceve (data, bookingIndex) e modifica in place; deve essere ri-applicabile
// perché in caso di conflitto rileggiamo lo stato fresco e ri-mutiamo una volta.
export async function mutateStore(admin: SupabaseClient, store: BookingStore, mutate: (data: Json, bookingIndex: number) => boolean): Promise<boolean> {
  const bookingId = String((store.booking as { id?: string }).id || "");
  const writeOnce = async (data: Json, idx: number, blob: Record<string, string>, keyCol: "user_id" | "org_id", keyVal: string, rev: number | null) => {
    if (!mutate(data, idx)) return "skip" as const;
    const nb = { ...blob, [DATA_KEY]: JSON.stringify(data) };
    let w = admin.from(store.table).update({ data: nb, updated_at: new Date().toISOString() }).eq(keyCol, keyVal);
    if (rev !== null) w = w.eq("rev", rev);
    const { data: updated, error } = await w.select("rev");
    if (error) throw new Error(error.message);
    return updated && updated.length > 0 ? ("ok" as const) : ("conflict" as const);
  };
  const r1 = await writeOnce(store.data, store.bookingIndex, store.blob, store.keyCol, store.keyVal, store.rev);
  if (r1 === "ok") return true;
  if (r1 === "skip") return false;
  // Conflitto: rileggi fresco e riprova una volta.
  const fresh = await scan(admin, store.table, store.keyCol, store.keyVal, bookingId);
  if (!fresh) return false;
  const r2 = await writeOnce(fresh.data, fresh.bookingIndex, fresh.blob, fresh.keyCol, fresh.keyVal, fresh.rev);
  return r2 === "ok";
}

// Trova la prenotazione col SOLO id (senza slug): cerca prima nelle organizzazioni
// condivise (poche righe), poi negli stati personali. Serve ai link di check-in che
// non portano lo slug (link interni / email vecchie). L'id prenotazione è un UUID.
// Nota: a grande scala converrà una tabella-indice booking→store; per ora scan diretto.
const FBS_WINDOW_MS = 60_000;
const FBS_MAX_MISSES = 60;
const FBS_CACHE_MS = 10 * 60_000;
const idCache = new Map<string, { table: "app_state" | "org_state"; keyCol: "user_id" | "org_id"; keyVal: string; exp: number }>();
const missHits: number[] = [];
/** Solo per i test: azzera cache e contatore delle ricerche fallite. */
export function _resetFindByIdState() { idCache.clear(); missHits.length = 0; }

export async function findBookingStoreById(admin: SupabaseClient, bookingId: string): Promise<BookingStore | null> {
  if (!bookingId || bookingId.length > 100) return null;
  const now = Date.now();
  // Id già trovato di recente: si rilegge SOLO quella riga (niente scansione di tutti i tenant, niente tetto). Gli ospiti veri restano serviti.
  const cached = idCache.get(bookingId);
  if (cached && cached.exp > now) {
    const hit = await scan(admin, cached.table, cached.keyCol, cached.keyVal, bookingId);
    if (hit) return hit;
    idCache.delete(bookingId);
  }
  // La ricerca senza slug scorre TUTTI i tenant (blob interi): con id inesistenti sarebbe un modo per saturare il database.
  // Tetto (per istanza) alle sole ricerche FALLITE, le uniche costose e senza esito; oltre, si risponde "non trovata".
  while (missHits.length && now - missHits[0] > FBS_WINDOW_MS) missHits.shift();
  if (missHits.length >= FBS_MAX_MISSES) return null;
  const found = (hit: BookingStore) => {
    if (idCache.size >= 2000) idCache.clear();
    idCache.set(bookingId, { table: hit.table, keyCol: hit.keyCol, keyVal: hit.keyVal, exp: now + FBS_CACHE_MS });
    return hit;
  };
  const { data: orgs } = await admin.from("org_state").select("org_id").limit(5000);
  for (const o of arr(orgs)) {
    const hit = await scan(admin, "org_state", "org_id", String((o as { org_id?: string }).org_id || ""), bookingId);
    if (hit) return found(hit);
  }
  const { data: users } = await admin.from("app_state").select("user_id").limit(10000);
  for (const u of arr(users)) {
    const hit = await scan(admin, "app_state", "user_id", String((u as { user_id?: string }).user_id || ""), bookingId);
    if (hit) return found(hit);
  }
  missHits.push(now);
  return null;
}

// Ritrova una prenotazione tra i dati a cui il TENANT ha accesso: le organizzazioni condivise
// di cui è membro attivo e il proprio stato personale. È la verifica di autorizzazione usata
// dal link di pagamento in chat (un gestore non può toccare prenotazioni di altri).
export async function findBookingStoreForTenant(admin: SupabaseClient, tenantId: string, bookingId: string): Promise<BookingStore | null> {
  if (!tenantId || !bookingId) return null;
  const { data: ms } = await admin.from("memberships").select("org_id, active").eq("user_id", tenantId);
  for (const m of arr(ms)) {
    if ((m as { active?: boolean }).active === false) continue;
    const orgId = String((m as { org_id?: string }).org_id || "");
    if (!orgId) continue;
    const hit = await scan(admin, "org_state", "org_id", orgId, bookingId);
    if (hit) { hit.ownerId = tenantId; return hit; }
  }
  const hit = await scan(admin, "app_state", "user_id", tenantId, bookingId);
  if (hit) { hit.ownerId = tenantId; return hit; }
  return null;
}

// Scrive una patch sull'oggetto prenotazione (rev-locked, un retry).
export async function writeBookingPatch(admin: SupabaseClient, store: BookingStore, patch: Json): Promise<boolean> {
  return mutateStore(admin, store, (data, idx) => {
    const bookings = arr(data.bookings);
    if (idx < 0 || idx >= bookings.length) return false;
    bookings[idx] = { ...(bookings[idx] as Json), ...patch };
    data.bookings = bookings;
    return true;
  });
}

// Valuta la politica di rimborso: entro la finestra gratuita?
// Le date sono giorni di calendario ITALIANI (Europe/Rome): il server gira in UTC, e tra le 00:00 e le 02:00 italiane "oggi" in UTC e' ancora ieri
// (la finestra gratuita sarebbe rimasta aperta un giorno in piu'). La scadenza e' arrivo meno N giorni (aritmetica di calendario, senza fusi).
export function refundEligible(booking: Json, nowISO: string): { free: boolean; freeUntil: string | null } {
  const refundable = (booking as { refundable?: boolean }).refundable === true;
  const cancelDays = Math.max(0, Math.round(Number((booking as { cancelDays?: number }).cancelDays) || 0));
  const checkIn = String((booking as { checkIn?: string }).checkIn || "");
  if (!refundable || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) return { free: false, freeUntil: null };
  // Con 0 giorni di preavviso l'ultimo giorno utile e' comunque la vigilia: dal giorno dell'arrivo l'ospite non puo' piu' annullare da solo
  // (cancel e "cancellable" rifiutano arrivo <= oggi), quindi la pagina non deve promettere "gratis fino al giorno dell'arrivo".
  const freeUntil = addDaysYmd(checkIn, -Math.max(1, cancelDays));
  const t = new Date(nowISO);
  const today = ymdRome(Number.isNaN(t.getTime()) ? new Date() : t);
  return { free: today <= freeUntil, freeUntil };
}

/**
 * Importo pagato e NON rimborsato su una prenotazione annullata dall'ospite (la struttura deve restituirlo a mano). Il valore scritto all'annullamento
 * (`unrefundedAmount`) vale sempre; per i dati vecchi si ricava: annullata dall'ospite in finestra gratuita e rimborsata meno di quanto pagato.
 */
export function unrefundedOf(b: Json): number {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (typeof b.unrefundedAmount === "number" && Number.isFinite(b.unrefundedAmount)) return Math.max(0, b.unrefundedAmount);
  if (b.status !== "cancelled" || b.cancelledBy !== "guest") return 0;
  const at = typeof b.cancelledAt === "string" && b.cancelledAt ? b.cancelledAt : new Date().toISOString();
  if (!refundEligible(b, at).free) return 0;
  return Math.max(0, Math.round((num(b.paid) - num(b.refundedAmount)) * 100) / 100);
}

/**
 * Pagamenti Stripe da rimborsare all'annullamento: il pagamento principale (si rimborsa per intero) piu' quelli successivi (saldo, ognuno per il suo importo).
 * `estimate` e' la cifra che la pagina /gestisci promette all'ospite: coincide con quanto la cancellazione rimborsa davvero (somma dei due, mai oltre l'incassato).
 */
export function stripeRefundPlan(b: Json): { main: string; extras: { pi: string; amount: number }[]; estimate: number } {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const main = typeof b.stripePaymentIntent === "string" ? b.stripePaymentIntent : "";
  const extras = (Array.isArray(b.stripeExtraPayments) ? (b.stripeExtraPayments as Json[]) : [])
    .map((x) => ({ pi: typeof x.pi === "string" ? x.pi : "", amount: num(x.amount) }))
    .filter((x) => x.pi && x.pi !== main && x.amount > 0);
  const extraSum = Math.round(extras.reduce((a, x) => a + x.amount, 0) * 100) / 100;
  const paid = Math.max(0, num(b.paid));
  const online = num(b.paidOnline) > 0 ? num(b.paidOnline) : paid;
  const mainAmount = main ? Math.max(0, Math.min(paid, online) - extraSum) : 0;
  return { main, extras, estimate: Math.round(Math.min(paid, mainAmount + extraSum) * 100) / 100 };
}
