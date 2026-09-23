// Servizio ISTAT / Turist@t (server-side). Alimenta le righe del movimento
// turistico dagli stessi ospiti/prenotazioni; invio con chiusura giornaliera.
// Provider astratto (regionale) — per ora mock; il connettore reale (Ross1000/
// Turist@t...) è uno scheletro da completare con le credenziali del portale.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Structure, Booking, Guest } from "@/lib/types";
import { logBookingEvent } from "@/lib/booking-events";
import { decryptCred } from "@/lib/crypto-creds";

const DATA_KEY = "spigolestay:data:v1";
type Blob = { structures?: Structure[]; bookings?: Booking[]; guests?: Guest[] };

async function readBlob(admin: SupabaseClient, tenantId: string): Promise<Blob> {
  const { data } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
  try { return JSON.parse(((data?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as Blob; } catch { return {}; }
}

// Genera/aggiorna le righe ISTAT (pending) dagli arrivi; conserva le già inviate.
export async function syncIstat(admin: SupabaseClient, tenantId: string, opts: { structureId?: string; fromDays?: number } = {}): Promise<{ count: number }> {
  const blob = await readBlob(admin, tenantId);
  const { data: sett } = await admin.from("istat_settings").select("structure_id, start_from").eq("tenant_id", tenantId);
  const startFrom = new Map((sett ?? []).map((s) => [s.structure_id as string, s.start_from as string | null]));
  const start = new Date(); start.setDate(start.getDate() - (opts.fromDays ?? 7));
  const startISO = start.toISOString().slice(0, 10);
  const guestsById = new Map((blob.guests ?? []).map((g) => [g.id, g]));

  const bookings = (blob.bookings ?? []).filter((b) =>
    b.status !== "cancelled" && b.channel !== "blocked" &&
    (b.checkIn || "") >= startISO && (!opts.structureId || b.structureId === opts.structureId));

  // Pulizia ORFANI: elimina le righe NON inviate di prenotazioni annullate/no-show
  // o non più esistenti, così il movimento turistico rispecchia sempre le prenotazioni attive.
  const activeIds = new Set((blob.bookings ?? []).filter((b) => b.status !== "cancelled" && b.channel !== "blocked").map((b) => b.id));
  {
    let q = admin.from("istat_rows").select("id, booking_id").eq("tenant_id", tenantId).neq("stato", "sent");
    if (opts.structureId) q = q.eq("structure_id", opts.structureId);
    const { data: existing } = await q;
    const orphanIds = ((existing ?? []) as { id: string; booking_id: string | null }[])
      .filter((r) => !r.booking_id || !activeIds.has(r.booking_id)).map((r) => r.id);
    if (orphanIds.length) await admin.from("istat_rows").delete().in("id", orphanIds);
  }

  let count = 0;
  for (const b of bookings) {
    const sf = startFrom.get(b.structureId);
    if (sf && b.checkIn < sf) continue; // non inviare movimenti prima della data indicata
    await admin.from("istat_rows").delete().eq("tenant_id", tenantId).eq("booking_id", b.id).neq("stato", "sent");
    const g = guestsById.get(b.guestId);
    const provenance = g?.province || g?.country || (g?.citizenship ?? "");
    const { error } = await admin.from("istat_rows").insert({
      tenant_id: tenantId, structure_id: b.structureId, booking_id: b.id,
      arrival: b.checkIn, departure: b.checkOut, provenance,
      guests: (b.adults ?? 1) + (b.children ?? 0), unit_id: b.unitId ?? null, stato: "pending",
    });
    if (!error) count += 1;
  }
  return { count };
}

// Chiusura/invio giornaliero (mock): segna come inviate le righe pending del giorno.
export async function closeDay(admin: SupabaseClient, tenantId: string, structureId: string, day?: string): Promise<{ ok: boolean; message: string; sent: number }> {
  const { data: sett } = await admin.from("istat_settings").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).maybeSingle();
  const provider = "mock"; // TODO(istat): connettore regionale reale (Ross1000/Turist@t) via credenziali sett
  let q = admin.from("istat_rows").select("id, booking_id").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "pending");
  if (day) q = q.eq("arrival", day);
  const { data: rows } = await q;
  const list = (rows ?? []) as { id: string; booking_id: string | null }[];
  const ids = list.map((r) => r.id);
  if (!ids.length) return { ok: false, message: "Nessuna riga da inviare.", sent: 0 };
  const istatPassword = decryptCred(sett?.password_enc);
  if (provider === "mock") {
    if (!sett?.username || !istatPassword) return { ok: false, message: "Credenziali ISTAT mancanti.", sent: 0 };
    await admin.from("istat_rows").update({ stato: "sent", esito: "Inviato (mock)" }).in("id", ids);
    for (const bid of Array.from(new Set(list.map((r) => r.booking_id).filter(Boolean))) as string[]) {
      await logBookingEvent(admin, tenantId, bid, "istat", "Movimento ISTAT inviato");
    }
    return { ok: true, message: `Movimento inviato: ${ids.length} righe (mock).`, sent: ids.length };
  }
  throw new Error("istat_provider_not_configured");
}
