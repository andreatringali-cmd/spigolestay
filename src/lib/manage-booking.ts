import type { SupabaseClient } from "@supabase/supabase-js";

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
export async function findBookingStoreById(admin: SupabaseClient, bookingId: string): Promise<BookingStore | null> {
  if (!bookingId) return null;
  const { data: orgs } = await admin.from("org_state").select("org_id").limit(5000);
  for (const o of arr(orgs)) {
    const hit = await scan(admin, "org_state", "org_id", String((o as { org_id?: string }).org_id || ""), bookingId);
    if (hit) return hit;
  }
  const { data: users } = await admin.from("app_state").select("user_id").limit(10000);
  for (const u of arr(users)) {
    const hit = await scan(admin, "app_state", "user_id", String((u as { user_id?: string }).user_id || ""), bookingId);
    if (hit) return hit;
  }
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
export function refundEligible(booking: Json, nowISO: string): { free: boolean; freeUntil: string | null } {
  const refundable = (booking as { refundable?: boolean }).refundable === true;
  const cancelDays = Math.max(0, Number((booking as { cancelDays?: number }).cancelDays) || 0);
  const checkIn = String((booking as { checkIn?: string }).checkIn || "");
  if (!refundable || !checkIn) return { free: false, freeUntil: null };
  // Scadenza = checkIn - cancelDays giorni
  const d = new Date(checkIn + "T00:00:00");
  d.setDate(d.getDate() - cancelDays);
  const freeUntil = d.toISOString().slice(0, 10);
  const today = nowISO.slice(0, 10);
  return { free: today <= freeUntil, freeUntil };
}
