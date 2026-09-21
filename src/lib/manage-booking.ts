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

// Scrive la prenotazione modificata nello stesso store, con lucchetto sul rev (una volta).
// patch viene applicata all'oggetto prenotazione. Ritorna true se scritto.
export async function writeBookingPatch(admin: SupabaseClient, store: BookingStore, patch: Json): Promise<boolean> {
  const apply = (data: Json, idx: number) => {
    const bookings = arr(data.bookings);
    if (idx < 0 || idx >= bookings.length) return false;
    bookings[idx] = { ...(bookings[idx] as Json), ...patch };
    data.bookings = bookings;
    return true;
  };
  if (!apply(store.data, store.bookingIndex)) return false;
  const blob = { ...store.blob, [DATA_KEY]: JSON.stringify(store.data) };
  let w = admin.from(store.table).update({ data: blob, updated_at: new Date().toISOString() }).eq(store.keyCol, store.keyVal);
  if (store.rev !== null) w = w.eq("rev", store.rev);
  const { data: updated, error } = await w.select("rev");
  if (error) throw new Error(error.message);
  if (updated && updated.length > 0) return true;

  // Conflitto di rev: rileggi, riapplica sull'indice aggiornato, riscrivi una volta.
  const fresh = await scan(admin, store.table, store.keyCol, store.keyVal, String((store.booking as { id?: string }).id || ""));
  if (!fresh) return false;
  if (!apply(fresh.data, fresh.bookingIndex)) return false;
  const blob2 = { ...fresh.blob, [DATA_KEY]: JSON.stringify(fresh.data) };
  let w2 = admin.from(store.table).update({ data: blob2, updated_at: new Date().toISOString() }).eq(store.keyCol, store.keyVal);
  if (fresh.rev !== null) w2 = w2.eq("rev", fresh.rev);
  const { data: u2, error: e2 } = await w2.select("rev");
  if (e2) throw new Error(e2.message);
  return !!(u2 && u2.length > 0);
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
