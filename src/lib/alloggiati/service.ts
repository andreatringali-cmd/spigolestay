// Servizio Alloggiati Web (server-side, service role). Genera le schedine dagli
// ospiti della prenotazione, valida il tracciato in locale, invia via provider.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Structure, Booking, Guest } from "@/lib/types";
import { nights } from "@/lib/dates";
import { getAlloggiatiProvider, type AlloggiatiCreds, type SchedinaPayload } from "./provider";
import { logBookingEvent } from "@/lib/booking-events";
import { decryptCred } from "@/lib/crypto-creds";
import { generateToken, authenticationTest, testSchedine as wsTest, sendSchedine as wsSend, ricevuta as wsRicevuta } from "./soap";
import { loadCodeMaps, resolveLuogo, resolveComuneFull, resolveDocumento, italyCode, syncTables, type CodeMaps } from "./codes";

// Attiva l'integrazione REALE col portale (SOAP) quando l'env flag è impostato e le
// credenziali sono complete; altrimenti resta il comportamento mock (nessuna rete).
const LIVE = process.env.ALLOGGIATI_LIVE === "1";

const DATA_KEY = "spigolestay:data:v1";

export interface SchedinaGuest {
  cognome?: string; nome?: string; sesso?: string; dataNascita?: string;
  comuneNascita?: string; provinciaNascita?: string; statoNascita?: string; cittadinanza?: string;
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

// Tracciato Alloggiati: 168 caratteri esatti (Tabella 1 del documento WS_ALLOGGIATI).
// Campi (DA-A, lunghezza): TipoAlloggiato 0-1(2) · DataArrivo 2-11(10) · Giorni 12-13(2)
// · Cognome 14-63(50) · Nome 64-93(30) · Sesso 94(1) · DataNascita 95-104(10)
// · ComuneNascita 105-113(9) · ProvinciaNascita 114-115(2) · StatoNascita 116-124(9)
// · Cittadinanza 125-133(9) · TipoDocumento 134-138(5) · NumeroDocumento 139-158(20)
// · LuogoRilascio 159-167(9). I codici (comune/stato/documento) arrivano dalle
// tabelle di codifica; senza tabelle si scrive il testo grezzo (il Test del portale
// segnalerà eventuali codici errati).
const fix = (s: string | undefined, n: number) => (s ?? "").toString().toUpperCase().slice(0, n).padEnd(n, " ");
const num2 = (n: number) => String(Math.max(0, Math.min(30, Math.round(n)))).padStart(2, "0");
const ymd = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "          ");
const isMember = (ruolo: string) => ruolo === "19" || ruolo === "20"; // familiare/membro: doc in blank

// Builder base (senza risoluzione codici): usa i valori testuali così come sono.
export function buildRecord(g: SchedinaGuest, ruolo: string, arrival: string, perm: number): string {
  const doc = isMember(ruolo);
  const rec = [
    fix(ruolo, 2), ymd(arrival), num2(perm), fix(g.cognome, 50), fix(g.nome, 30),
    fix(g.sesso === "F" ? "2" : "1", 1), ymd(g.dataNascita),
    fix(g.comuneNascita, 9), fix((g as { provinciaNascita?: string }).provinciaNascita, 2), fix(g.statoNascita, 9), fix(g.cittadinanza, 9),
    doc ? "".padEnd(5, " ") : fix(g.tipoDoc, 5), doc ? "".padEnd(20, " ") : fix(g.numeroDoc, 20), doc ? "".padEnd(9, " ") : fix(g.luogoRilascio, 9),
  ].join("");
  return rec.slice(0, 168).padEnd(168, " ");
}

// Builder con risoluzione dei codici ufficiali dalle tabelle in cache.
export function buildRecordResolved(g: SchedinaGuest, ruolo: string, arrival: string, perm: number, maps: CodeMaps): string {
  const gp = g as { provinciaNascita?: string };
  const comune = resolveComuneFull(maps, g.comuneNascita, gp.provinciaNascita);
  const bornInItaly = !!comune?.provincia; // se ha una provincia è un comune italiano
  let comuneCode = "", provCode = "", statoNascitaCode = "";
  if (bornInItaly && comune) {
    comuneCode = comune.code; provCode = (comune.provincia ?? "").toUpperCase();
    statoNascitaCode = resolveLuogo(maps, g.statoNascita) || italyCode(maps) || "";
  } else {
    // Nato all'estero (o comune non riconosciuto): comune/provincia in blank, stato = paese.
    statoNascitaCode = resolveLuogo(maps, g.statoNascita) || resolveLuogo(maps, g.comuneNascita) || "";
  }
  const cittadinanzaCode = resolveLuogo(maps, g.cittadinanza) || "";
  const doc = isMember(ruolo);
  const tipoDocCode = doc ? "" : (resolveDocumento(maps, g.tipoDoc) || "");
  const luogoRilCode = doc ? "" : (resolveLuogo(maps, g.luogoRilascio) || "");
  const rec = [
    fix(ruolo, 2), ymd(arrival), num2(perm), fix(g.cognome, 50), fix(g.nome, 30),
    fix(g.sesso === "F" ? "2" : "1", 1), ymd(g.dataNascita),
    fix(comuneCode, 9), fix(provCode, 2), fix(statoNascitaCode, 9), fix(cittadinanzaCode, 9),
    fix(tipoDocCode, 5), doc ? "".padEnd(20, " ") : fix(g.numeroDoc, 20), fix(luogoRilCode, 9),
  ].join("");
  return rec.slice(0, 168).padEnd(168, " ");
}

type Blob = { structures?: Structure[]; bookings?: Booking[]; guests?: Guest[] };
async function readBlob(admin: SupabaseClient, tenantId: string): Promise<Blob> {
  const { data } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
  try { return JSON.parse(((data?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as Blob; } catch { return {}; }
}

const toG = (src: Partial<Guest> & Record<string, unknown> | undefined): SchedinaGuest => ({
  cognome: src?.lastName as string, nome: src?.firstName as string, sesso: src?.sex as string,
  dataNascita: src?.birthDate as string, comuneNascita: src?.birthPlace as string,
  provinciaNascita: (src?.birthProvince as string) || (src?.birthProv as string),
  statoNascita: (src?.birthCountry as string) || (src?.countryOfBirth as string),
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

  const isInactive = (b: { status?: string; channel?: string }) => b.status === "cancelled" || b.status === "no_show" || b.channel === "blocked";
  const bookings = (blob.bookings ?? []).filter((b) =>
    !isInactive(b) &&
    (b.checkIn || "") >= startISO && (!opts.structureId || b.structureId === opts.structureId));

  // Pulizia ORFANI: elimina le schedine NON inviate le cui prenotazioni sono state annullate/no-show
  // o non esistono più (es. camera rivenduta). Così un no-show non lascia schedine "da mandare".
  const activeIds = new Set((blob.bookings ?? []).filter((b) => !isInactive(b)).map((b) => b.id));
  {
    let q = admin.from("alloggiati_schedine").select("id, booking_id").eq("tenant_id", tenantId).neq("stato", "inviata");
    if (opts.structureId) q = q.eq("structure_id", opts.structureId);
    const { data: existing } = await q;
    const orphanIds = ((existing ?? []) as { id: string; booking_id: string | null }[])
      .filter((r) => !r.booking_id || !activeIds.has(r.booking_id)).map((r) => r.id);
    if (orphanIds.length) await admin.from("alloggiati_schedine").delete().in("id", orphanIds);
  }

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

async function creds(admin: SupabaseClient, tenantId: string, structureId: string): Promise<{ c: AlloggiatiCreds; live: boolean }> {
  const { data } = await admin.from("alloggiati_settings").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).maybeSingle();
  const c: AlloggiatiCreds = { username: data?.username, password: decryptCred(data?.password_enc), wsCode: decryptCred(data?.ws_code_enc) };
  return { c, live: LIVE && !!c.username && !!c.password && !!c.wsCode };
}

// Ottiene un token valido dal web service reale. Lancia con messaggio parlante in caso di errore.
async function getToken(c: AlloggiatiCreds): Promise<string> {
  const { result, token } = await generateToken(c.username!, c.password!, c.wsCode!);
  if (!result.esito || !token.token) throw new Error(result.errorDes || result.errorDettaglio || "Autenticazione Alloggiati fallita (verifica Username, Password e Webservice Code).");
  return token.token;
}

export async function testConnection(admin: SupabaseClient, tenantId: string, structureId: string): Promise<{ ok: boolean; message: string }> {
  const { data } = await admin.from("alloggiati_settings").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).maybeSingle();
  let res: { ok: boolean; message: string };
  if (!data) {
    res = { ok: false, message: `Nessuna credenziale salvata per questa struttura (${structureId.slice(0, 8)}…). Seleziona questa struttura e salva Username, Password e Webservice Code.` };
  } else {
    const c: AlloggiatiCreds = { username: data.username, password: decryptCred(data.password_enc), wsCode: decryptCred(data.ws_code_enc) };
    const hasEnc = !!data.password_enc && !!data.ws_code_enc;
    const complete = !!c.username && !!c.password && !!c.wsCode;
    if (!complete && hasEnc) {
      res = { ok: false, message: "Credenziali salvate ma NON decifrabili: la chiave del server (CRED_SECRET) non coincide con quella usata al salvataggio. Reinserisci e salva di nuovo Password e Webservice Code." };
    } else if (!complete) {
      res = { ok: false, message: "Credenziali incomplete: inserisci Username, Password e Webservice Code, poi Salva." };
    } else if (!LIVE) {
      res = { ok: true, message: "Credenziali presenti ma invio reale non attivo (ALLOGGIATI_LIVE). Contatta l'amministratore." };
    } else {
      try {
        const token = await getToken(c);
        const auth = await authenticationTest(c.username!, token);
        res = { ok: auth.esito, message: auth.esito ? "Connessione al portale Alloggiati riuscita ✓" : (auth.errorDes || "Token non valido.") };
      } catch (e) { res = { ok: false, message: (e as Error)?.message ?? "Errore di connessione al portale." }; }
    }
  }
  await admin.from("alloggiati_settings").update({ status: res.ok ? "attivata" : "errore", status_msg: res.message, last_test_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("structure_id", structureId);
  return res;
}

// Scarica/aggiorna le tabelle di codifica (Luoghi, Tipi_Documento) dal portale reale.
export async function syncCodeTables(admin: SupabaseClient, tenantId: string, structureId: string): Promise<{ ok: boolean; message: string }> {
  const { c, live } = await creds(admin, tenantId, structureId);
  if (!live) return { ok: false, message: "Integrazione reale non attiva (ALLOGGIATI_LIVE) o credenziali incomplete." };
  try {
    const token = await getToken(c);
    const r = await syncTables(admin, c.username!, token);
    return { ok: true, message: `Tabelle aggiornate: ${r.luoghi} luoghi, ${r.documenti} tipi documento.` };
  } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Errore aggiornamento tabelle." }; }
}

// Controllo preliminare (Test) delle schedine PRONTE senza inviarle. Aggiorna gli
// eventuali errori riga-per-riga sulle schedine.
export async function testReady(admin: SupabaseClient, tenantId: string, structureId: string, arrival?: string): Promise<{ ok: boolean; message: string }> {
  const { c, live } = await creds(admin, tenantId, structureId);
  if (!live) return { ok: false, message: "Integrazione reale non attiva: usa mock (nessun controllo dal portale)." };
  let q = admin.from("alloggiati_schedine").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "pronta");
  if (arrival) q = q.eq("arrival", arrival);
  const { data: sched } = await q;
  const list = sched ?? [];
  if (!list.length) return { ok: false, message: "Nessuna schedina pronta da controllare." };
  try {
    const token = await getToken(c);
    const maps = await loadCodeMaps(admin);
    const records = list.map((s) => buildRecordResolved(s.guest as SchedinaGuest, s.ruolo, s.arrival, (s.guest as { perm?: number })?.perm ?? 1, maps));
    const { result, elenco } = await wsTest(c.username!, token, records);
    // Riporta gli esiti sulle singole schedine.
    for (let i = 0; i < list.length; i++) {
      const d = elenco.dettaglio[i];
      if (d && !d.esito) await admin.from("alloggiati_schedine").update({ errors: [d.errorDes, d.errorDettaglio].filter(Boolean) }).eq("id", list[i].id);
      else await admin.from("alloggiati_schedine").update({ errors: null }).eq("id", list[i].id);
    }
    const invalid = elenco.dettaglio.filter((d) => !d.esito).length;
    return { ok: result.esito && invalid === 0, message: invalid ? `${elenco.schedineValide}/${list.length} valide, ${invalid} con errori (vedi dettaglio schedine).` : `Tutte valide (${elenco.schedineValide}/${list.length}).` };
  } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Errore nel controllo schedine." }; }
}

// Scarica la ricevuta PDF (base64) di una data specifica (ultimi 30gg, escluso oggi).
export async function fetchRicevuta(admin: SupabaseClient, tenantId: string, structureId: string, isoDate: string): Promise<{ ok: boolean; message: string; pdfBase64?: string }> {
  const { c, live } = await creds(admin, tenantId, structureId);
  if (!live) return { ok: false, message: "Integrazione reale non attiva." };
  try {
    const token = await getToken(c);
    const r = await wsRicevuta(c.username!, token, isoDate);
    if (!r.result.esito || !r.pdfBase64) return { ok: false, message: r.result.errorDes || "Ricevuta non disponibile per questa data." };
    return { ok: true, message: "Ricevuta scaricata.", pdfBase64: r.pdfBase64 };
  } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Errore scaricamento ricevuta." }; }
}

// Invia le schedine PRONTE (arrivo indicato o tutte) → submission + ricevuta.
export async function sendReady(admin: SupabaseClient, tenantId: string, structureId: string, arrival?: string): Promise<{ ok: boolean; message: string; sent: number }> {
  let q = admin.from("alloggiati_schedine").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "pronta");
  if (arrival) q = q.eq("arrival", arrival);
  const { data: sched } = await q;
  const list = sched ?? [];
  if (!list.length) return { ok: false, message: "Nessuna schedina pronta da inviare.", sent: 0 };

  const { c, live } = await creds(admin, tenantId, structureId);

  // Costruisce i record: con codici risolti se l'integrazione reale è attiva.
  const maps: CodeMaps | null = live ? await loadCodeMaps(admin) : null;
  const records = list.map((s) => (maps
    ? buildRecordResolved(s.guest as SchedinaGuest, s.ruolo, s.arrival, (s.guest as { perm?: number })?.perm ?? 1, maps)
    : buildRecord(s.guest as SchedinaGuest, s.ruolo, s.arrival, (s.guest as { perm?: number })?.perm ?? 1)));
  const payload: SchedinaPayload[] = list.map((s, i) => ({ record: records[i], guest: s.guest }));

  const { data: sub } = await admin.from("alloggiati_submissions").insert({ tenant_id: tenantId, structure_id: structureId, arrival: arrival ?? null, stato: "pending", count: list.length, payload }).select("id").single();

  let res: { ok: boolean; message: string; ricevuta?: string; perLine?: boolean[] };
  if (live) {
    try {
      const token = await getToken(c);
      const { result, elenco } = await wsSend(c.username!, token, records);
      const perLine = list.map((_, i) => elenco.dettaglio[i]?.esito ?? result.esito);
      const invalid = perLine.filter((v) => !v).length;
      const ric = `RIC-${new Date().toISOString().slice(0, 10)}`;
      res = { ok: result.esito && invalid === 0, message: invalid ? `${elenco.schedineValide}/${list.length} acquisite, ${invalid} con errori.` : `Inviate ${elenco.schedineValide} schedine alla Questura.`, ricevuta: result.esito ? ric : undefined, perLine };
    } catch (e) { res = { ok: false, message: (e as Error)?.message ?? "Errore invio schedine." }; }
  } else {
    const r = await getAlloggiatiProvider("mock").send(c, payload);
    res = { ok: r.ok, message: r.message, ricevuta: r.ricevuta };
  }

  await admin.from("alloggiati_submissions").update({ stato: res.ok ? "sent" : "error", esito: res.message, ricevuta: res.ricevuta ?? null, tentativi: 1 }).eq("id", sub!.id);
  // Segna come inviate le schedine effettivamente acquisite (per-riga se disponibile).
  const sentIds = list.filter((_, i) => (res.perLine ? res.perLine[i] : res.ok)).map((s) => s.id);
  if (sentIds.length) {
    await admin.from("alloggiati_schedine").update({ stato: "inviata", submission_id: sub!.id, ricevuta: res.ricevuta ?? null }).in("id", sentIds);
    const sentBookings = list.filter((_, i) => (res.perLine ? res.perLine[i] : res.ok)).map((s) => s.booking_id);
    for (const bid of Array.from(new Set(sentBookings.filter(Boolean))) as string[]) {
      await logBookingEvent(admin, tenantId, bid, "schedina", "Schedina Alloggiati inviata alla Questura");
    }
  }
  return { ok: res.ok, message: res.message, sent: sentIds.length };
}
