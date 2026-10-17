// Servizio ISTAT / Turist@t (server-side). Alimenta le righe del movimento
// turistico dagli stessi ospiti/prenotazioni; invio con chiusura giornaliera.
// Provider astratto (regionale) — per ora mock; il connettore reale (Ross1000/
// Turist@t...) è uno scheletro da completare con le credenziali del portale.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrgDatas, mergeOrgData } from "@/lib/concierge-orgdata";
import type { Structure, Booking, Guest } from "@/lib/types";
import { logBookingEvent } from "@/lib/booking-events";
import { todayRome, addDaysYmd } from "@/lib/dates-rome";
import { decryptCred } from "@/lib/crypto-creds";
import { sendDaily, type DailyMovement } from "@/lib/istat/turistat";

// Invio reale al portale regionale (Turist@t) attivo solo con ISTAT_LIVE=1 e credenziali complete.
const ISTAT_LIVE = process.env.ISTAT_LIVE === "1";
const DATA_KEY = "spigolestay:data:v1";
type Blob = { structures?: Structure[]; bookings?: Booking[]; guests?: Guest[]; units?: { id: string; structureId: string; outOfService?: boolean }[] };

// Dati del tenant: personali + strutture CONDIVISE (org_state delle sue membership). Senza le org le strutture condivise risultavano vuote
// e la pulizia degli "orfani" cancellava le schedine/righe non inviate.
async function readBlob(admin: SupabaseClient, tenantId: string): Promise<Blob> {
  const { data } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
  let personal: Blob = {};
  try { personal = JSON.parse(((data?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as Blob; } catch { personal = {}; }
  const orgs = await loadOrgDatas(admin, tenantId);
  return mergeOrgData(personal as Record<string, unknown>, orgs) as Blob;
}

// Genera/aggiorna le righe ISTAT (pending) dagli arrivi; conserva le già inviate.
export async function syncIstat(admin: SupabaseClient, tenantId: string, opts: { structureId?: string; fromDays?: number } = {}): Promise<{ count: number }> {
  const blob = await readBlob(admin, tenantId);
  const { data: sett } = await admin.from("istat_settings").select("structure_id, start_from").eq("tenant_id", tenantId);
  const startFrom = new Map((sett ?? []).map((s) => [s.structure_id as string, s.start_from as string | null]));
  const startISO = addDaysYmd(todayRome(), -(opts.fromDays ?? 7));
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
    // Provenienza: residenza dalla scheda ospite; altrimenti cittadinanza di chi ha fatto il check-in (primaryGuest della prenotazione prima dell'anagrafica condivisa).
    const provenance = g?.province || g?.country || b.primaryGuest?.citizenship || (g?.citizenship ?? "");
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
export function buildDailyMovement(blob: Blob, structureId: string, day: string): DailyMovement {
  // Camere totali della struttura (escluse quelle fuori servizio): servono al tasso di occupazione del portale.
  const units = (blob.units ?? []).filter((u) => u.structureId === structureId && !u.outOfService).length;
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
    // Dati di chi ha fatto il check-in: prima quelli della prenotazione (primaryGuest), poi l'anagrafica ospite (condivisa fra le camere di un gruppo).
    const main = {
      permanenza: nights(b.checkIn, b.checkOut), camera: b.unitId ?? undefined,
      eta: ageFrom(pg.birthDate || g?.birthDate), sesso: (pg.sex || g?.sex || undefined) as "M" | "F" | undefined,
      cittadinanza: pg.citizenship || g?.citizenship, luogoNascita: pg.birthPlace || g?.birthPlace,
      luogoResidenza: g?.province ?? g?.country ?? undefined,
    };
    const extra = (b.extraGuests ?? []).map((c) => ({ permanenza: nights(b.checkIn, b.checkOut), camera: b.unitId ?? undefined, eta: ageFrom(c.birthDate), sesso: c.sex as "M" | "F" | undefined, cittadinanza: c.citizenship, luogoNascita: c.birthPlace, luogoResidenza: undefined }));
    return [main, ...extra];
  });
  return { day, arrivati, partiti, presenti, camereOccupate, camereTotali: units, ospiti };
}

// Chiusura/invio giornaliero. Con ISTAT_LIVE + credenziali → invio reale al portale (Turist@t);
// altrimenti mock. Marca come inviate le righe pending del giorno.
// Messaggio dell'esito quando l'invio reale non è attivo: nulla parte, nulla viene segnato come inviato.
export const ISTAT_SIMULATED_MSG = "Simulato (invio reale non attivo): nulla è stato inviato al portale Turist@t, i movimenti restano da inviare.";

// `simulated`: true quando l'invio reale non è attivo (ISTAT_LIVE spento): le righe restano "pending",
// nessun evento "Movimento ISTAT inviato", nessuna riga nell'archivio invii.
export async function closeDay(admin: SupabaseClient, tenantId: string, structureId: string, day?: string): Promise<{ ok: boolean; message: string; sent: number; simulated?: boolean }> {
  const { data: sett } = await admin.from("istat_settings").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).maybeSingle();
  const today = todayRome();
  // Un giorno futuro non si chiude: i movimenti non sono ancora avvenuti.
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, message: "Data non valida.", sent: 0 };
    if (day > today) return { ok: false, message: "Non puoi chiudere un giorno futuro: scegli oggi o una data passata.", sent: 0 };
  }
  let q = admin.from("istat_rows").select("id, booking_id, arrival").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "pending");
  // Si invia per gli arrivi già avvenuti: senza un giorno specifico, escludi gli arrivi futuri.
  if (day) q = q.eq("arrival", day);
  else q = q.lte("arrival", today);
  const { data: rows } = await q;
  const list = (rows ?? []) as { id: string; booking_id: string | null; arrival?: string | null }[];
  const ids = list.map((r) => r.id);
  if (!ids.length) return { ok: false, message: "Nessuna riga da inviare.", sent: 0 };

  const istatPassword = decryptCred(sett?.password_enc);
  if (!sett?.username || !istatPassword) return { ok: false, message: "Credenziali ISTAT mancanti: apri le impostazioni e inserisci username e password.", sent: 0 };

  const live = ISTAT_LIVE && !!sett.username && !!istatPassword;
  // Invio reale non attivo: esito SIMULATO, nessuna riga segnata come inviata.
  if (!live) return { ok: false, message: ISTAT_SIMULATED_MSG, sent: 0, simulated: true };

  // Un movimento per OGNI giorno di arrivo: senza `day` le righe pending possono essere di più giorni (invii falliti/simulati nei giorni scorsi)
  // e ogni giorno va inviato col suo movimento; si segna "inviata" solo la riga del giorno realmente trasmesso.
  const byDay = new Map<string, typeof list>();
  for (const r of list) { const d = day ?? r.arrival ?? today; const a = byDay.get(d) ?? []; a.push(r); byDay.set(d, a); }
  const days = Array.from(byDay.keys()).sort();

  let blob: Blob;
  try { blob = await readBlob(admin, tenantId); } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Errore invio al portale Turist@t.", sent: 0 }; }
  let sentTotal = 0;
  for (const d of days) {
    const dayRows = byDay.get(d) ?? [];
    const dayIds = dayRows.map((r) => r.id);
    let esito: string;
    try {
      const movement = buildDailyMovement(blob, structureId, d);
      const r = await sendDaily({ username: sett.username, password: istatPassword }, movement);
      if (!r.ok) return { ok: false, message: sentTotal ? `${r.message} (inviati ${sentTotal} movimenti prima dell'errore, giorno ${d})` : r.message, sent: sentTotal };
      esito = r.ricevuta ? `Inviato · ric. ${r.ricevuta}` : "Inviato al portale Turist@t";
    } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Errore invio al portale Turist@t.", sent: sentTotal }; }

    await admin.from("istat_rows").update({ stato: "sent", esito }).in("id", dayIds);
    for (const bid of Array.from(new Set(dayRows.map((r) => r.booking_id).filter(Boolean))) as string[]) {
      await logBookingEvent(admin, tenantId, bid, "istat", "Movimento ISTAT inviato");
    }
    // Storico: registra la chiusura giornaliera (archivio invii ISTAT).
    try { await admin.from("istat_submissions").insert({ tenant_id: tenantId, structure_id: structureId, day: d, count: dayIds.length, stato: "sent", esito }); } catch {}
    sentTotal += dayIds.length;
  }
  return { ok: true, message: `Movimento inviato al portale: ${sentTotal} righe.`, sent: sentTotal };
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
