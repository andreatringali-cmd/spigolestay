// Servizio ISTAT / Turist@t (server-side). Alimenta le righe del movimento
// turistico dagli stessi ospiti/prenotazioni; invio con chiusura giornaliera.
// Provider astratto (regionale) — per ora mock; il connettore reale (Ross1000/
// Turist@t...) è uno scheletro da completare con le credenziali del portale.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Structure, Booking, Guest } from "@/lib/types";
import { logBookingEvent } from "@/lib/booking-events";
import { decryptCred } from "@/lib/crypto-creds";
import { sendDaily, type DailyMovement } from "@/lib/istat/turistat";

// Invio reale al portale regionale (Turist@t) attivo solo con ISTAT_LIVE=1 e credenziali complete.
const ISTAT_LIVE = process.env.ISTAT_LIVE === "1";
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

  const isInactive = (b: { status?: string; channel?: string }) => b.status === "cancelled" || b.status === "no_show" || b.channel === "blocked";
  const bookings = (blob.bookings ?? []).filter((b) =>
    !isInactive(b) &&
    (b.checkIn || "") >= startISO && (!opts.structureId || b.structureId === opts.structureId));

  // Pulizia ORFANI: elimina le righe NON inviate di prenotazioni annullate/no-show
  // o non più esistenti, così il movimento turistico rispecchia sempre le prenotazioni attive.
  const activeIds = new Set((blob.bookings ?? []).filter((b) => !isInactive(b)).map((b) => b.id));
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
    // Ripulisci eventuali righe non inviate della prenotazione (evita duplicati)…
    await admin.from("istat_rows").delete().eq("tenant_id", tenantId).eq("booking_id", b.id).neq("stato", "sent");
    // …e se la prenotazione è già stata INVIATA, non ricreare una riga pending (niente doppioni sent+pending).
    const { data: alreadySent } = await admin.from("istat_rows").select("id").eq("tenant_id", tenantId).eq("booking_id", b.id).eq("stato", "sent").limit(1);
    if (alreadySent && alreadySent.length) continue;
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

// Costruisce la chiusura giornaliera (stile Turist@t) dai dati prenotazione per un giorno.
function buildDailyMovement(blob: Blob, structureId: string, day: string): DailyMovement {
  const units = 0; // le camere totali stanno nel client; qui non servono al calcolo movimento
  const guestsById = new Map((blob.guests ?? []).map((g) => [g.id, g]));
  const isInactive = (b: { status?: string; channel?: string }) => b.status === "cancelled" || b.status === "no_show" || b.channel === "blocked";
  const act = (blob.bookings ?? []).filter((b) => b.structureId === structureId && !isInactive(b));
  const pax = (b: Booking) => (b.adults ?? 1) + (b.children ?? 0);
  const nights = (ci?: string, co?: string) => { if (!ci || !co) return 0; return Math.max(0, Math.round((new Date(co + "T00:00").getTime() - new Date(ci + "T00:00").getTime()) / 86400000)); };
  const arrivati = act.filter((b) => b.checkIn === day).reduce((a, b) => a + pax(b), 0);
  const partiti = act.filter((b) => b.checkOut === day).reduce((a, b) => a + pax(b), 0);
  const present = act.filter((b) => b.checkIn <= day && day < b.checkOut);
  const presenti = present.reduce((a, b) => a + pax(b), 0);
  const camereOccupate = present.length;
  const ageFrom = (iso?: string) => { if (!iso) return undefined; const d = new Date(iso); const t = new Date(day); let a = t.getFullYear() - d.getFullYear(); if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--; return a >= 0 && a < 130 ? a : undefined; };
  // Dettaglio movimento (anonimo) degli arrivi del giorno.
  const ospiti = act.filter((b) => b.checkIn === day).flatMap((b) => {
    const g = guestsById.get(b.guestId);
    const pg = b.primaryGuest ?? {};
    const main = {
      permanenza: nights(b.checkIn, b.checkOut), camera: b.unitId ?? undefined,
      eta: ageFrom(g?.birthDate ?? pg.birthDate), sesso: (g?.sex ?? pg.sex) as "M" | "F" | undefined,
      cittadinanza: g?.citizenship ?? pg.citizenship, luogoNascita: g?.birthPlace ?? pg.birthPlace,
      luogoResidenza: g?.province ?? g?.country ?? undefined,
    };
    const extra = (b.extraGuests ?? []).map((c) => ({ permanenza: nights(b.checkIn, b.checkOut), camera: b.unitId ?? undefined, eta: ageFrom(c.birthDate), sesso: c.sex as "M" | "F" | undefined, cittadinanza: c.citizenship, luogoNascita: c.birthPlace, luogoResidenza: undefined }));
    return [main, ...extra];
  });
  return { day, arrivati, partiti, presenti, camereOccupate, camereTotali: units, ospiti };
}

// Chiusura/invio giornaliero. Con ISTAT_LIVE + credenziali → invio reale al portale (Turist@t);
// altrimenti mock. Marca come inviate le righe pending del giorno.
export async function closeDay(admin: SupabaseClient, tenantId: string, structureId: string, day?: string): Promise<{ ok: boolean; message: string; sent: number }> {
  const { data: sett } = await admin.from("istat_settings").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).maybeSingle();
  const today = new Date().toISOString().slice(0, 10);
  let q = admin.from("istat_rows").select("id, booking_id").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "pending");
  // Si invia per gli arrivi già avvenuti: senza un giorno specifico, escludi gli arrivi futuri.
  if (day) q = q.eq("arrival", day);
  else q = q.lte("arrival", today);
  const { data: rows } = await q;
  const list = (rows ?? []) as { id: string; booking_id: string | null }[];
  const ids = list.map((r) => r.id);
  if (!ids.length) return { ok: false, message: "Nessuna riga da inviare.", sent: 0 };

  const istatPassword = decryptCred(sett?.password_enc);
  if (!sett?.username || !istatPassword) return { ok: false, message: "Credenziali ISTAT mancanti: aprile impostazioni e inserisci username e password.", sent: 0 };

  const live = ISTAT_LIVE && !!sett.username && !!istatPassword;
  let esito = "Inviato (mock)";
  if (live) {
    try {
      const blob = await readBlob(admin, tenantId);
      const movement = buildDailyMovement(blob, structureId, day ?? today);
      const r = await sendDaily({ username: sett.username, password: istatPassword }, movement);
      if (!r.ok) return { ok: false, message: r.message, sent: 0 };
      esito = r.ricevuta ? `Inviato · ric. ${r.ricevuta}` : "Inviato al portale Turist@t";
    } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Errore invio al portale Turist@t.", sent: 0 }; }
  }

  await admin.from("istat_rows").update({ stato: "sent", esito }).in("id", ids);
  for (const bid of Array.from(new Set(list.map((r) => r.booking_id).filter(Boolean))) as string[]) {
    await logBookingEvent(admin, tenantId, bid, "istat", "Movimento ISTAT inviato");
  }
  // Storico: registra la chiusura giornaliera (archivio invii ISTAT).
  try { await admin.from("istat_submissions").insert({ tenant_id: tenantId, structure_id: structureId, day: day ?? today, count: ids.length, stato: "sent", esito }); } catch {}
  return { ok: true, message: live ? `Movimento inviato al portale: ${ids.length} righe.` : `Movimento inviato: ${ids.length} righe (demo).`, sent: ids.length };
}

// Archivio invii ISTAT: elenco delle chiusure giornaliere (storico).
export async function listIstatSubmissions(admin: SupabaseClient, tenantId: string, structureId: string): Promise<{ ok: boolean; items: { id: string; day: string | null; created_at: string; count: number; stato: string; esito: string | null }[] }> {
  const { data } = await admin.from("istat_submissions")
    .select("id, day, created_at, count, stato, esito")
    .eq("tenant_id", tenantId).eq("structure_id", structureId)
    .order("created_at", { ascending: false }).limit(200);
  const items = (data ?? []).map((s) => ({ id: s.id as string, day: (s.day as string) ?? null, created_at: s.created_at as string, count: (s.count as number) ?? 0, stato: (s.stato as string) ?? "", esito: (s.esito as string) ?? null }));
  return { ok: true, items };
}
