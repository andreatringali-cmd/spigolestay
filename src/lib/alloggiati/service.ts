// Servizio Alloggiati Web (server-side, service role). Genera le schedine dagli
// ospiti della prenotazione, valida il tracciato in locale, invia via provider.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Structure, Booking, Guest } from "@/lib/types";
import { nights } from "@/lib/dates";
import { getAlloggiatiProvider, type AlloggiatiCreds, type SchedinaPayload } from "./provider";

const DATA_KEY = "spigolestay:data:v1";

export interface SchedinaGuest {
  cognome?: string; nome?: string; sesso?: string; dataNascita?: string;
  comuneNascita?: string; statoNascita?: string; cittadinanza?: string;
  tipoDoc?: string; numeroDoc?: string; luogoRilascio?: string;
}

// Ruoli ufficiali Alloggiati: 16 singolo, 17 capofamiglia, 18 capogruppo, 19 familiare, 20 membro.
export function roleFor(index: number, total: number, group: boolean): string {
  if (!group || total <= 1) return "16";
  return index === 0 ? "17" : "19";
}

// Validazione locale del tracciato (per evitare scarti). Ritorna elenco errori.
export function validateSchedina(g: SchedinaGuest, ruolo: string): string[] {
  const e: string[] = [];
  if (!g.cognome?.trim()) e.push("Cognome mancante");
  if (!g.nome?.trim()) e.push("Nome mancante");
  if (!g.sesso) e.push("Sesso mancante");
  if (!g.dataNascita) e.push("Data di nascita mancante");
  if (!g.comuneNascita?.trim() && !g.statoNascita?.trim()) e.push("Luogo di nascita mancante");
  if (!g.cittadinanza?.trim()) e.push("Cittadinanza mancante");
  // Documento obbligatorio per singolo/capofamiglia/capogruppo (16/17/18), non per i membri.
  if (["16", "17", "18"].includes(ruolo)) {
    if (!g.tipoDoc?.trim()) e.push("Tipo documento mancante");
    if (!g.numeroDoc?.trim()) e.push("Numero documento mancante");
    if (!g.luogoRilascio?.trim()) e.push("Luogo rilascio documento mancante");
  }
  return e;
}

// Tracciato Alloggiati 168 caratteri (semplificato: la validazione dei contenuti è
// quella sopra; l'esattezza dei codici catastali/stati arriva dalle tabelle codifica).
const fix = (s: string | undefined, n: number) => (s ?? "").toString().toUpperCase().slice(0, n).padEnd(n, " ");
const ymd = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "          ");
export function buildRecord(g: SchedinaGuest, ruolo: string, arrival: string, perm: number): string {
  return [
    fix(ruolo, 2), ymd(arrival), fix(String(perm), 2), fix(g.cognome, 50), fix(g.nome, 30),
    fix(g.sesso === "F" ? "2" : "1", 1), ymd(g.dataNascita),
    fix(g.comuneNascita, 9), fix(g.statoNascita, 9), fix(g.cittadinanza, 9),
    fix(g.tipoDoc, 5), fix(g.numeroDoc, 20), fix(g.luogoRilascio, 9),
  ].join("");
}

type Blob = { structures?: Structure[]; bookings?: Booking[]; guests?: Guest[] };
async function readBlob(admin: SupabaseClient, tenantId: string): Promise<Blob> {
  const { data } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
  try { return JSON.parse(((data?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as Blob; } catch { return {}; }
}

const toG = (src: Partial<Guest> & Record<string, unknown> | undefined): SchedinaGuest => ({
  cognome: src?.lastName as string, nome: src?.firstName as string, sesso: src?.sex as string,
  dataNascita: src?.birthDate as string, comuneNascita: src?.birthPlace as string,
  cittadinanza: (src?.citizenship as string) || (src?.country as string),
  tipoDoc: src?.docType as string, numeroDoc: src?.docNumber as string, luogoRilascio: src?.docPlace as string,
});

// Genera/aggiorna le schedine (stato da_validare/pronta) per gli arrivi del tenant.
// Rigenera solo le NON inviate; conserva quelle già inviate.
export async function syncSchedine(admin: SupabaseClient, tenantId: string, opts: { structureId?: string; fromDays?: number } = {}): Promise<{ count: number }> {
  const blob = await readBlob(admin, tenantId);
  const { data: settRows } = await admin.from("alloggiati_settings").select("structure_id, group_guests").eq("tenant_id", tenantId);
  const groupBy = new Map((settRows ?? []).map((s) => [s.structure_id as string, s.group_guests as boolean]));
  const start = new Date(); start.setDate(start.getDate() - (opts.fromDays ?? 7));
  const startISO = start.toISOString().slice(0, 10);

  const bookings = (blob.bookings ?? []).filter((b) =>
    b.status !== "cancelled" && b.channel !== "blocked" &&
    (b.checkIn || "") >= startISO && (!opts.structureId || b.structureId === opts.structureId));

  let count = 0;
  for (const b of bookings) {
    // Non toccare le schedine già inviate per questa prenotazione.
    await admin.from("alloggiati_schedine").delete().eq("tenant_id", tenantId).eq("booking_id", b.id).neq("stato", "inviata");
    const primary = b.primaryGuest ?? (blob.guests ?? []).find((g) => g.id === b.guestId);
    const people: SchedinaGuest[] = [toG(primary as Record<string, unknown>), ...((b.extraGuests ?? []).map((e) => toG(e as Record<string, unknown>)))];
    const group = groupBy.get(b.structureId) ?? true;
    const perm = nights(b.checkIn, b.checkOut);
    const rows = people.map((g, i) => {
      const ruolo = roleFor(i, people.length, group);
      const errors = validateSchedina(g, ruolo);
      return {
        tenant_id: tenantId, structure_id: b.structureId, booking_id: b.id,
        guest_ref: i === 0 ? "primary" : `extra:${i - 1}`, arrival: b.checkIn, guest: { ...g, perm },
        ruolo, stato: errors.length ? "da_validare" : "pronta", errors: errors.length ? errors : null,
      };
    });
    if (rows.length) { const { error } = await admin.from("alloggiati_schedine").insert(rows); if (!error) count += rows.length; }
  }
  return { count };
}

async function creds(admin: SupabaseClient, tenantId: string, structureId: string): Promise<{ c: AlloggiatiCreds; provider: string }> {
  const { data } = await admin.from("alloggiati_settings").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).maybeSingle();
  return { c: { username: data?.username, password: data?.password_enc, wsCode: data?.ws_code_enc }, provider: "mock" };
}

export async function testConnection(admin: SupabaseClient, tenantId: string, structureId: string): Promise<{ ok: boolean; message: string }> {
  const { c, provider } = await creds(admin, tenantId, structureId);
  const res = await getAlloggiatiProvider(provider).test(c);
  await admin.from("alloggiati_settings").update({ status: res.ok ? "attivata" : "errore", status_msg: res.message, last_test_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("structure_id", structureId);
  return res;
}

// Invia le schedine PRONTE (arrivo indicato o tutte) → submission + ricevuta.
export async function sendReady(admin: SupabaseClient, tenantId: string, structureId: string, arrival?: string): Promise<{ ok: boolean; message: string; sent: number }> {
  let q = admin.from("alloggiati_schedine").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "pronta");
  if (arrival) q = q.eq("arrival", arrival);
  const { data: sched } = await q;
  const list = sched ?? [];
  if (!list.length) return { ok: false, message: "Nessuna schedina pronta da inviare.", sent: 0 };

  const { c, provider } = await creds(admin, tenantId, structureId);
  const payload: SchedinaPayload[] = list.map((s) => ({ record: buildRecord(s.guest as SchedinaGuest, s.ruolo, s.arrival, (s.guest as { perm?: number })?.perm ?? 1), guest: s.guest }));

  const { data: sub } = await admin.from("alloggiati_submissions").insert({ tenant_id: tenantId, structure_id: structureId, arrival: arrival ?? null, stato: "pending", count: list.length, payload }).select("id").single();
  const res = await getAlloggiatiProvider(provider).send(c, payload);
  await admin.from("alloggiati_submissions").update({ stato: res.ok ? "sent" : "error", esito: res.message, ricevuta: res.ricevuta ?? null, tentativi: 1 }).eq("id", sub!.id);
  if (res.ok) {
    await admin.from("alloggiati_schedine").update({ stato: "inviata", submission_id: sub!.id, ricevuta: res.ricevuta ?? null }).in("id", list.map((s) => s.id));
  }
  return { ok: res.ok, message: res.message, sent: res.ok ? list.length : 0 };
}
