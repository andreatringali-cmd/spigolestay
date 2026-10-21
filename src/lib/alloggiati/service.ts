// Servizio Alloggiati Web (server-side, service role). Genera le schedine dagli
// ospiti della prenotazione, valida il tracciato in locale, invia via provider.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTenantData } from "@/lib/concierge-orgdata";
import type { Structure, Booking, Guest } from "@/lib/types";
import { nights } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { todayRome, ymdRome, addDaysYmd } from "@/lib/dates-rome";
import { getAlloggiatiProvider, type AlloggiatiCreds, type SchedinaPayload } from "./provider";
import { logBookingEvent } from "@/lib/booking-events";
import { decryptCred } from "@/lib/crypto-creds";
import { generateToken, authenticationTest, testSchedine as wsTest, sendSchedine as wsSend, ricevuta as wsRicevuta } from "./soap";
import { loadCodeMaps, resolveSchedinaCodes, syncTables, type CodeMaps } from "./codes";

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

// ── Testo del tracciato ──────────────────────────────────────────────────────────────────────────
// Nomi: senza accenti, solo A-Z, spazio e apostrofo (il portale rifiuta il resto), spazi compressi.
const LATIN_EXTRA: Record<string, string> = { "Ø": "O", "Æ": "AE", "Œ": "OE", "Ł": "L", "Đ": "D", "Þ": "TH", "Ð": "D", "ß": "SS", "ı": "I" };
export function cleanName(s: string | undefined | null): string {
  return (s ?? "").toString()
    .replace(/[ØÆŒŁĐÞÐßı]/gi, (c) => LATIN_EXTRA[c] ?? LATIN_EXTRA[c.toUpperCase()] ?? c)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^A-Z' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Numero documento: solo lettere e cifre maiuscole (spazi e trattini tolti).
export function cleanDocNumber(s: string | undefined | null): string {
  return (s ?? "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
const isoOk = (d?: string): boolean => {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return false;
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === dd && y >= 1900;
};

// Validazione locale del tracciato (per evitare scarti). Ritorna elenco errori.
// Con le tabelle di codifica (`maps`) controlla anche che cittadinanza, luogo di nascita, tipo documento e luogo di rilascio
// si traducano in un CODICE valido: altrimenti il tracciato avrebbe spazi al loro posto e il portale lo rifiuterebbe.
export function validateSchedina(g: SchedinaGuest, ruolo: string, maps?: CodeMaps | null, today: string = todayRome(), arrival?: string): string[] {
  const e: string[] = [];
  if (arrival !== undefined && !isoOk(arrival)) e.push("Data di arrivo non valida");
  if (!g.cognome?.trim()) e.push("Cognome mancante");
  else if (!cleanName(g.cognome)) e.push("Cognome non valido (servono lettere)"); // oltre 50 caratteri NON è un errore: nel tracciato si tronca
  if (!g.nome?.trim()) e.push("Nome mancante");
  else if (!cleanName(g.nome)) e.push("Nome non valido (servono lettere)"); // oltre 30 caratteri: troncato nel tracciato
  if (!g.sesso) e.push("Sesso mancante");
  else if (g.sesso !== "M" && g.sesso !== "F") e.push("Sesso non valido (M o F)");
  if (!g.dataNascita) e.push("Data di nascita mancante");
  else if (!isoOk(g.dataNascita)) e.push("Data di nascita non valida");
  else if (g.dataNascita.slice(0, 10) > today) e.push("Data di nascita nel futuro");
  if (!g.comuneNascita?.trim() && !g.statoNascita?.trim()) e.push("Luogo di nascita mancante");
  if (!g.cittadinanza?.trim()) e.push("Cittadinanza mancante");
  // Documento obbligatorio per singolo/capofamiglia/capogruppo (16/17/18), non per i membri.
  if (["16", "17", "18"].includes(ruolo)) {
    if (!g.tipoDoc?.trim()) e.push("Tipo documento mancante");
    if (!g.numeroDoc?.trim()) e.push("Numero documento mancante");
    else { const dn = cleanDocNumber(g.numeroDoc); if (!dn) e.push("Numero documento non valido"); else if (dn.length > 20) e.push(`Numero documento troppo lungo: ${dn.length} caratteri (massimo 20)`); }
    if (!g.luogoRilascio?.trim()) e.push("Luogo rilascio documento mancante");
  }
  if (maps?.hasData) e.push(...resolveSchedinaCodes(g, isMember(ruolo), maps).issues);
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
const fixName = (s: string | undefined, n: number) => cleanName(s).slice(0, n).padEnd(n, " ");
const num2 = (n: number) => String(Math.max(1, Math.min(30, Math.round(n) || 1))).padStart(2, "0"); // giorni di permanenza: almeno 1 (anche con arrivo e partenza lo stesso giorno)
// Data nel tracciato: gg/mm/aaaa. Se non è una data ISO valida lascia 10 spazi (la validazione la segnala) invece di scrivere un valore a caso.
const ymd = (iso?: string) => (isoOk(iso) ? (iso as string).slice(0, 10).split("-").reverse().join("/") : "          ");
const isMember = (ruolo: string) => ruolo === "19" || ruolo === "20"; // familiare/membro: doc in blank

// Builder base (senza risoluzione codici): usa i valori testuali così come sono.
export function buildRecord(g: SchedinaGuest, ruolo: string, arrival: string, perm: number): string {
  const doc = isMember(ruolo);
  const rec = [
    fix(ruolo, 2), ymd(arrival), num2(perm), fixName(g.cognome, 50), fixName(g.nome, 30),
    fix(g.sesso === "F" ? "2" : "1", 1), ymd(g.dataNascita),
    fixName(g.comuneNascita, 9), fix((g as { provinciaNascita?: string }).provinciaNascita, 2), fixName(g.statoNascita, 9), fixName(g.cittadinanza, 9),
    doc ? "".padEnd(5, " ") : fix(g.tipoDoc, 5), doc ? "".padEnd(20, " ") : fix(cleanDocNumber(g.numeroDoc), 20), doc ? "".padEnd(9, " ") : fixName(g.luogoRilascio, 9),
  ].join("");
  return rec.slice(0, 168).padEnd(168, " ");
}

// Builder con risoluzione dei codici ufficiali dalle tabelle in cache.
export function buildRecordResolved(g: SchedinaGuest, ruolo: string, arrival: string, perm: number, maps: CodeMaps): string {
  const member = isMember(ruolo);
  const c = resolveSchedinaCodes(g, member, maps);
  const rec = [
    fix(ruolo, 2), ymd(arrival), num2(perm), fixName(g.cognome, 50), fixName(g.nome, 30),
    fix(g.sesso === "F" ? "2" : "1", 1), ymd(g.dataNascita),
    fix(c.comune, 9), fix(c.prov, 2), fix(c.statoNascita, 9), fix(c.cittadinanza, 9),
    fix(c.tipoDoc, 5), member ? "".padEnd(20, " ") : fix(cleanDocNumber(g.numeroDoc), 20), fix(c.luogoRilascio, 9),
  ].join("");
  return rec.slice(0, 168).padEnd(168, " ");
}

type Blob = { structures?: Structure[]; bookings?: Booking[]; guests?: Guest[] };
// Dati del tenant: personali + strutture CONDIVISE (org_state delle sue membership). Senza le org le strutture condivise risultavano vuote
// e la pulizia degli "orfani" cancellava le schedine/righe non inviate.
// Con SERVER_READ_ENTITIES=on legge dalle tabelle (vedi concierge-orgdata.ts / SERVER-ENTITIES.md); off = come sempre.
async function readBlob(admin: SupabaseClient, tenantId: string): Promise<Blob> {
  return (await loadTenantData(admin, tenantId)) as Blob;
}

const toG = (src: Partial<Guest> & Record<string, unknown> | undefined): SchedinaGuest => ({
  cognome: src?.lastName as string, nome: src?.firstName as string, sesso: src?.sex as string,
  dataNascita: src?.birthDate as string, comuneNascita: src?.birthPlace as string,
  provinciaNascita: (src?.birthProvince as string) || (src?.birthProv as string),
  statoNascita: (src?.birthCountry as string) || (src?.countryOfBirth as string),
  cittadinanza: (src?.citizenship as string) || (src?.country as string),
  tipoDoc: src?.docType as string, numeroDoc: src?.docNumber as string, luogoRilascio: src?.docPlace as string,
});

// Le tabelle dei codici sono uguali per tutti i tenant e cambiano di rado: per la sincronizzazione delle schedine (chiamata a ogni check-in) si tengono in memoria 5 minuti
// invece di rileggere ~9000 righe ogni volta. L'invio (sendReady) legge sempre fresco.
let mapsCache: { at: number; maps: CodeMaps } | null = null;
const MAPS_TTL_MS = 5 * 60 * 1000;
export function resetCodeMapsCache(): void { mapsCache = null; }
async function codeMapsForSync(admin: SupabaseClient): Promise<CodeMaps | null> {
  if (mapsCache && Date.now() - mapsCache.at < MAPS_TTL_MS) return mapsCache.maps;
  try { const m = await loadCodeMaps(admin); if (!m.hasData) return null; mapsCache = { at: Date.now(), maps: m }; return m; } catch { return null; }
}

/** Check-in compilato (come la UI: Adempimenti, Alloggiati Web, percorso della prenotazione): online completato, oppure ospite principale con cognome e documento. */
export const hasCheckedIn = (b: { webCheckin?: boolean; primaryGuest?: { lastName?: string; docNumber?: string } }): boolean =>
  b.webCheckin === true || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber);

/** JSON con chiavi ordinate: Postgres (jsonb) riordina le chiavi, quindi per confrontare due "guest" non basta JSON.stringify. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stableJson((v as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(v ?? null);
}

type PrevRow = { guest_ref: string | null; guest: unknown; arrival: string; errors: string[] | null };
/** Gli errori che vengono dal PORTALE (non dai controlli locali) iniziano sempre con questo prefisso. */
export const PORTAL_PREFIX = "Portale: ";
export const isPortalRejection = (errors: string[] | null | undefined): boolean => !!errors?.length && errors[0].startsWith(PORTAL_PREFIX);
/** Messaggi di una riga rifiutata dal portale (errorDes + errorDettaglio), pronti da salvare in `errors`. */
export function portalErrors(d: { errorDes?: string; errorDettaglio?: string } | undefined): string[] {
  const des = (d?.errorDes ?? "").trim(), det = (d?.errorDettaglio ?? "").trim();
  return [PORTAL_PREFIX + (des || det || "schedina rifiutata"), ...(des && det && det !== des ? [det] : [])];
}

// Genera/aggiorna le schedine (stato da_validare/pronta) per gli arrivi del tenant.
// Rigenera solo le NON inviate; conserva quelle già inviate.
// `bookingId`: sincronizza SOLO quella prenotazione (usato dal check-in online: evita 2 query per ogni prenotazione della finestra, rischio timeout).
export async function syncSchedine(admin: SupabaseClient, tenantId: string, opts: { structureId?: string; fromDays?: number; bookingId?: string } = {}): Promise<{ count: number }> {
  const blob = await readBlob(admin, tenantId);
  const { data: settRows } = await admin.from("alloggiati_settings").select("structure_id, group_guests").eq("tenant_id", tenantId);
  const groupBy = new Map((settRows ?? []).map((s) => [s.structure_id as string, s.group_guests as boolean]));
  const startISO = addDaysYmd(todayRome(), -(opts.fromDays ?? 7));

  const isInactive = (b: { status?: string; channel?: string }) => b.status === "cancelled" || b.status === "no_show" || b.channel === "blocked";
  const bookings = (blob.bookings ?? []).filter((b) =>
    !isInactive(b) &&
    (b.checkIn || "") >= startISO && (!opts.structureId || b.structureId === opts.structureId) && (!opts.bookingId || b.id === opts.bookingId));

  // Pulizia ORFANI: elimina le schedine NON inviate le cui prenotazioni sono state annullate/no-show
  // o non esistono più (es. camera rivenduta). Così un no-show non lascia schedine "da mandare".
  const activeIds = new Set((blob.bookings ?? []).filter((b) => !isInactive(b)).map((b) => b.id));
  {
    let q = admin.from("alloggiati_schedine").select("id, booking_id").eq("tenant_id", tenantId).neq("stato", "inviata");
    if (opts.structureId) q = q.eq("structure_id", opts.structureId);
    if (opts.bookingId) q = q.eq("booking_id", opts.bookingId);
    const { data: existing } = await q;
    const orphanIds = ((existing ?? []) as { id: string; booking_id: string | null }[])
      .filter((r) => !r.booking_id || !activeIds.has(r.booking_id)).map((r) => r.id);
    if (orphanIds.length) await admin.from("alloggiati_schedine").delete().in("id", orphanIds);
  }

  // Tabelle di codifica (Luoghi, Tipi_Documento): servono per controllare che cittadinanza, luogo di nascita, tipo documento e luogo di rilascio
  // si traducano in un codice. Se non sono ancora state scaricate (o la lettura fallisce) il controllo sui codici si salta.
  const maps = await codeMapsForSync(admin);

  let count = 0;
  for (const b of bookings) {
    // Righe già presenti di questa prenotazione, lette subito prima di rigenerarle (così un invio appena concluso da sendReady si vede):
    // le NON inviate servono per ricordare i RIFIUTI del portale (vedi sotto); le INVIATE non si ricreano mai (né la prenotazione intera né il singolo ospite),
    // altrimenti la stessa schedina ripartirebbe alla Questura a ogni riapertura/ricalcolo: si inseriscono solo i guest_ref che non hanno ancora una riga inviata.
    const { data: existingRows } = await admin.from("alloggiati_schedine").select("guest_ref, guest, arrival, errors, stato").eq("tenant_id", tenantId).eq("booking_id", b.id);
    const prevRows = ((existingRows ?? []) as (PrevRow & { stato?: string })[]).filter((r) => r.stato !== "inviata");
    const alreadySent = new Set(((existingRows ?? []) as (PrevRow & { stato?: string })[]).filter((r) => r.stato === "inviata").map((r) => r.guest_ref ?? "primary"));
    // Non toccare le schedine già inviate per questa prenotazione.
    await admin.from("alloggiati_schedine").delete().eq("tenant_id", tenantId).eq("booking_id", b.id).neq("stato", "inviata");
    // Senza check-in compilato non nasce nessuna schedina: i dati sulla scheda ospite possono essere vecchi (ospite di ritorno) e verrebbero inviati alla Questura.
    if (!hasCheckedIn(b)) continue;
    const primary = b.primaryGuest ?? (blob.guests ?? []).find((g) => g.id === b.guestId);
    const people: SchedinaGuest[] = [toG(primary as Record<string, unknown>), ...((b.extraGuests ?? []).map((e) => toG(e as Record<string, unknown>)))];
    const group = groupBy.get(b.structureId) ?? true;
    const perm = Math.max(1, nights(b.checkIn, b.checkOut)); // arrivo e partenza lo stesso giorno = 1 giorno di permanenza, mai 0
    // Check-in COMPLETO solo se le persone dichiarate coprono gli ospiti attesi: se ne mancano,
    // la prenotazione è "da completare" e NESSUNA sua schedina è "pronta" (resta "da_validare").
    const expectedPax = Math.max(1, (b.adults ?? 1) + (b.children ?? 0));
    const incomplete = people.length < expectedPax;
    const rows = people.map((g, i) => {
      const ruolo = roleFor(i, people.length, group);
      const guest = { ...g, perm };
      const ref = i === 0 ? "primary" : `extra:${i - 1}`;
      const errors = [...validateSchedina(g, ruolo, maps, todayRome(), b.checkIn)];
      if (incomplete) errors.push(`Ospiti incompleti: ${people.length}/${expectedPax}`);
      // Rifiuto del portale su QUESTI stessi dati: la schedina resta da correggere finché i dati non cambiano (altrimenti verrebbe rimandata ogni sera).
      const prev = prevRows.find((r) => r.guest_ref === ref);
      const portalErrors = prev && prev.arrival === b.checkIn && isPortalRejection(prev.errors) && stableJson(prev.guest) === stableJson(guest) ? prev.errors : null;
      const all = portalErrors ? [...(portalErrors as string[]), ...errors.filter((m) => !(portalErrors as string[]).includes(m))] : errors;
      return {
        tenant_id: tenantId, structure_id: b.structureId, booking_id: b.id,
        guest_ref: ref, arrival: b.checkIn, guest,
        ruolo, stato: all.length ? "da_validare" : "pronta", errors: all.length ? all : null,
      };
    });
    const toInsert = alreadySent.size ? rows.filter((row) => !alreadySent.has(row.guest_ref)) : rows;
    if (toInsert.length) { const { error } = await admin.from("alloggiati_schedine").insert(toInsert); if (!error) count += toInsert.length; }
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
    resetCodeMapsCache();
    return { ok: true, message: `Tabelle aggiornate: ${r.luoghi} luoghi, ${r.documenti} tipi documento.` };
  } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Errore aggiornamento tabelle." }; }
}

// ── Invio: regole pure (testabili senza rete) ─────────────────────────────────────────────────────

/** Esito per riga di un Send: serve il via libera del servizio E quello della singola riga. Se il portale non ha restituito il dettaglio ci si fida dell'esito generale; dettaglio incompleto = righe mancanti NON confermate. */
export function evalSend(resultEsito: boolean, dettaglio: { esito: boolean }[], n: number): boolean[] {
  return Array.from({ length: n }, (_, i) => resultEsito && (dettaglio.length === 0 ? true : dettaglio[i] ? dettaglio[i].esito === true : false));
}

/**
 * Righe che possono partire: una famiglia (= prenotazione) parte INTERA o per niente. Esclude le righe delle prenotazioni che hanno almeno
 * una riga non pronta (`notReadyBookings`) o una riga da non inviare (`badRowIds`: dati da correggere, rifiuto del portale).
 */
export function sendableRows<T extends { id: string; booking_id: string | null }>(ready: T[], notReadyBookings: Iterable<string>, badRowIds: Iterable<string>): { send: T[]; held: T[] } {
  const blocked = new Set<string>(notReadyBookings);
  const bad = new Set<string>(badRowIds);
  for (const r of ready) if (bad.has(r.id) && r.booking_id) blocked.add(r.booking_id);
  const send: T[] = [], held: T[] = [];
  for (const r of ready) (bad.has(r.id) || (r.booking_id && blocked.has(r.booking_id)) ? held : send).push(r);
  return { send, held };
}

type SchedRowDb = { id: string; booking_id: string | null; arrival: string; guest: unknown; ruolo: string; guest_ref?: string | null };
const permOf = (s: SchedRowDb) => Math.max(1, (s.guest as { perm?: number } | null)?.perm ?? 1);

/**
 * Ordine di invio: per arrivo, poi per prenotazione, e dentro la prenotazione il capofamiglia/capogruppo/singolo (16, 17, 18) PRIMA dei familiari/membri (19, 20),
 * che devono seguirlo consecutivi: il portale lega i familiari al capofamiglia che li precede nel file. A parità, ordine dei co-ospiti (extra:0, extra:1…).
 */
export function sendOrder(a: { arrival: string; booking_id: string | null; ruolo: string; guest_ref?: string | null }, b: { arrival: string; booking_id: string | null; ruolo: string; guest_ref?: string | null }): number {
  const rank = (r: string) => (r === "19" || r === "20" ? 1 : 0);
  const idx = (g?: string | null) => { const m = /^extra:(\d+)$/.exec(g ?? ""); return m ? Number(m[1]) + 1 : 0; };
  return a.arrival.localeCompare(b.arrival) || (a.booking_id ?? "").localeCompare(b.booking_id ?? "") || rank(a.ruolo) - rank(b.ruolo) || idx(a.guest_ref) - idx(b.guest_ref);
}
const recordOf = (s: SchedRowDb, maps: CodeMaps) => buildRecordResolved(s.guest as SchedinaGuest, s.ruolo, s.arrival, permOf(s), maps);

// Controllo preliminare (Test) delle schedine PRONTE senza inviarle. Aggiorna gli
// eventuali errori riga-per-riga sulle schedine (le rifiutate diventano "da_validare" con il messaggio del portale).
export async function testReady(admin: SupabaseClient, tenantId: string, structureId: string, arrival?: string): Promise<{ ok: boolean; message: string }> {
  const { c, live } = await creds(admin, tenantId, structureId);
  if (!live) return { ok: false, message: "Integrazione reale non attiva: usa mock (nessun controllo dal portale)." };
  let q = admin.from("alloggiati_schedine").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "pronta");
  // Si controllano solo gli arrivi GIÀ avvenuti: gli arrivi futuri (in preparazione) non si verificano.
  if (arrival) q = q.eq("arrival", arrival);
  else q = q.lte("arrival", todayRome());
  const { data: sched } = await q.order("arrival").order("booking_id");
  const list = [...(sched ?? [])].sort(sendOrder);
  if (!list.length) return { ok: true, message: "Nessuna schedina da controllare." };
  try {
    const token = await getToken(c);
    const maps = await loadCodeMaps(admin);
    const records = list.map((s) => recordOf(s as SchedRowDb, maps));
    const { result, elenco } = await wsTest(c.username!, token, records);
    // Riporta gli esiti sulle singole schedine.
    for (let i = 0; i < list.length; i++) {
      const d = elenco.dettaglio[i];
      if (d && !d.esito) await admin.from("alloggiati_schedine").update({ errors: portalErrors(d), stato: "da_validare" }).eq("id", list[i].id);
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

// Genera il tracciato .txt (168 char/riga) delle schedine PRONTE — fallback per l'invio manuale sul portale.
export async function buildTracciato(admin: SupabaseClient, tenantId: string, structureId: string): Promise<{ ok: boolean; message: string; text?: string; count?: number }> {
  const today = todayRome();
  const { data } = await admin.from("alloggiati_schedine").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "pronta").lte("arrival", today);
  const list = data ?? [];
  if (!list.length) return { ok: false, message: "Nessuna schedina pronta (gli arrivi futuri si inviano dopo l'arrivo)." };
  // Con le tabelle dei codici scaricate il tracciato porta i CODICI (anche con l'invio automatico spento): senza, il portale lo rifiuterebbe.
  let maps: CodeMaps | null = null;
  try { const m = await loadCodeMaps(admin); if (m.hasData) maps = m; } catch { maps = null; }
  // Righe con dati da correggere: fuori dal file (il portale rifiuterebbe l'intero caricamento).
  const okRows = list.filter((s) => validateSchedina(s.guest as SchedinaGuest, s.ruolo, maps).length === 0);
  const skipped = list.length - okRows.length;
  if (!okRows.length) return { ok: false, message: `Nessuna schedina valida per il tracciato: ${skipped} con dati da correggere (vedi dettaglio schedine).` };
  const lines = okRows.map((s) => (maps
    ? buildRecordResolved(s.guest as SchedinaGuest, s.ruolo, s.arrival, (s.guest as { perm?: number })?.perm ?? 1, maps)
    : buildRecord(s.guest as SchedinaGuest, s.ruolo, s.arrival, (s.guest as { perm?: number })?.perm ?? 1)));
  return { ok: true, message: `Tracciato con ${plural(lines.length, "schedina", "schedine")}.${skipped ? ` ${skipped} escluse perché da correggere.` : ""}`, text: lines.join("\r\n"), count: lines.length };
}

// Archivio invii: elenco degli invii effettuati (per riscaricare/stampare la ricevuta in qualsiasi momento).
export async function listSubmissions(admin: SupabaseClient, tenantId: string, structureId: string): Promise<{ ok: boolean; items: { id: string; date: string | null; created_at: string; count: number; stato: string; esito: string | null; ricevuta: string | null; hasPdf: boolean }[] }> {
  const { data } = await admin.from("alloggiati_submissions")
    .select("id, arrival, created_at, count, stato, esito, ricevuta, ricevuta_pdf")
    .eq("tenant_id", tenantId).eq("structure_id", structureId)
    .order("created_at", { ascending: false }).limit(200);
  const items = (data ?? []).map((s) => ({ id: s.id as string, date: (s.arrival as string) ?? null, created_at: s.created_at as string, count: (s.count as number) ?? 0, stato: (s.stato as string) ?? "", esito: (s.esito as string) ?? null, ricevuta: (s.ricevuta as string) ?? null, hasPdf: !!s.ricevuta_pdf }));
  return { ok: true, items };
}

// Ricevuta di uno specifico invio: usa quella memorizzata; se manca, la scarica dal portale (per data) e la conserva.
export async function getSubmissionRicevuta(admin: SupabaseClient, tenantId: string, structureId: string, submissionId: string): Promise<{ ok: boolean; message: string; pdfBase64?: string }> {
  const { data: sub } = await admin.from("alloggiati_submissions").select("id, created_at, ricevuta_pdf").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("id", submissionId).maybeSingle();
  if (!sub) return { ok: false, message: "Invio non trovato." };
  if (sub.ricevuta_pdf) return { ok: true, message: "Ricevuta dall'archivio.", pdfBase64: sub.ricevuta_pdf as string };
  const day = ymdRome(String(sub.created_at));
  const r = await fetchRicevuta(admin, tenantId, structureId, day);
  if (r.ok && r.pdfBase64) { try { await admin.from("alloggiati_submissions").update({ ricevuta_pdf: r.pdfBase64 }).eq("id", submissionId); } catch {} return r; }
  // La ricevuta è disponibile sul portale dal giorno DOPO l'invio ed entro ~30 giorni.
  const today = todayRome();
  if (day >= today) return { ok: false, message: "La ricevuta sarà disponibile dal giorno successivo all'invio: riprova domani." };
  return r;
}

// Messaggio dell'esito quando l'invio reale non è attivo: nulla parte, nulla viene segnato come inviato.
export const ALLOGGIATI_SIMULATED_MSG = "Simulato (invio reale non attivo): nulla è stato inviato alla Questura, le schedine restano da inviare.";

// Invia le schedine PRONTE (arrivo indicato o tutte) → submission + ricevuta.
// `simulated`: true quando l'invio reale non è attivo (ALLOGGIATI_LIVE spento o credenziali incomplete):
// in quel caso NON si segna nulla come inviato, non si scrive l'evento e non si cancellano le foto.
// Regole di sicurezza:
//  - una famiglia (= prenotazione) parte INTERA o per niente: se una sua riga è da correggere/rifiutata, non parte nessuna riga di quella prenotazione;
//  - prima dell'invio si ricontrollano i dati in locale (codici inclusi) e si fa il Test del portale: le righe rifiutate restano "da_validare" con il messaggio
//    del portale (in `errors`), così una sola schedina sbagliata non blocca le altre e non si riprova alla cieca ogni sera;
//  - "inviata" solo se sia l'esito generale sia quello della riga sono positivi.
// `blocked` = righe pronte tenute indietro (dati da correggere o famiglia incompleta).
export async function sendReady(admin: SupabaseClient, tenantId: string, structureId: string, arrival?: string): Promise<{ ok: boolean; message: string; sent: number; simulated?: boolean; blocked?: number }> {
  let q = admin.from("alloggiati_schedine").select("*").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "pronta");
  // La schedina si invia DOPO l'arrivo: nell'invio massivo escludiamo gli arrivi futuri.
  if (arrival) q = q.eq("arrival", arrival);
  else q = q.lte("arrival", todayRome());
  // Il portale vuole il capofamiglia (17) prima dei familiari (19) consecutivi: ordine per arrivo e prenotazione, poi per ruolo.
  const { data: sched } = await q.order("arrival").order("booking_id");
  const list = ([...(sched ?? [])] as (SchedRowDb & { guest: SchedinaGuest })[]).sort(sendOrder);
  if (!list.length) return { ok: false, message: "Nessuna schedina pronta da inviare (gli arrivi futuri si inviano dopo l'arrivo).", sent: 0 };

  const { c, live } = await creds(admin, tenantId, structureId);

  // Invio reale non attivo: esito SIMULATO. Nessun invio, nessuna submission, nessuna schedina segnata
  // "inviata", nessun evento "inviata alla Questura", nessuna foto cancellata.
  if (!live) {
    const t = await getAlloggiatiProvider("mock").test(c);
    if (!t.ok) return { ok: false, message: t.message, sent: 0 };
    return { ok: false, message: ALLOGGIATI_SIMULATED_MSG, sent: 0, simulated: true };
  }

  const maps: CodeMaps = await loadCodeMaps(admin);
  // Senza le tabelle dei codici il tracciato avrebbe i campi comune/Stato/documento vuoti: il portale lo rifiuterebbe (o, peggio, lo accetterebbe incompleto).
  if (!maps.hasData) return { ok: false, message: "Scarica prima le tabelle codici (Luoghi e Tipi documento) dalle impostazioni Alloggiati Web: senza non si può inviare.", sent: 0 };

  // 1) Famiglie spezzate: prenotazioni con righe non pronte (da correggere / ospiti mancanti) → nessuna delle loro righe parte.
  const notReady = new Set<string>();
  const bids = Array.from(new Set(list.map((s) => s.booking_id).filter(Boolean))) as string[];
  for (let i = 0; i < bids.length; i += 100) {
    const { data: nr } = await admin.from("alloggiati_schedine").select("booking_id").eq("tenant_id", tenantId).eq("structure_id", structureId).eq("stato", "da_validare").in("booking_id", bids.slice(i, i + 100));
    for (const r of (nr ?? []) as { booking_id: string | null }[]) if (r.booking_id) notReady.add(r.booking_id);
  }

  // 2) Riconvalida in locale (le righe possono essere state generate prima delle tabelle dei codici o con regole più larghe).
  const bad = new Set<string>();
  for (const s of list) {
    const errs = validateSchedina(s.guest, s.ruolo, maps, todayRome(), s.arrival);
    if (errs.length) { bad.add(s.id); await admin.from("alloggiati_schedine").update({ errors: errs, stato: "da_validare" }).eq("id", s.id); }
  }

  let { send, held } = sendableRows(list, notReady, bad);
  if (!send.length) return { ok: false, message: `${held.length === 1 ? "Schedina non inviata" : "Schedine non inviate"}: ${held.length} con dati da correggere o famiglia incompleta (vedi dettaglio schedine).`, sent: 0, blocked: held.length };

  const payload: SchedinaPayload[] = send.map((s) => ({ record: recordOf(s, maps), guest: s.guest as unknown as Record<string, unknown> }));
  const { data: sub } = await admin.from("alloggiati_submissions").insert({ tenant_id: tenantId, structure_id: structureId, arrival: arrival ?? null, stato: "pending", count: send.length, payload }).select("id").single();

  let res: { ok: boolean; message: string; ricevuta?: string };
  let accepted: SchedRowDb[] = [];
  let sendCalled = false; // il Send vero è stato chiamato (ha senso conservare l'esito in archivio)
  try {
    const token = await getToken(c);

    // 3) Test del portale: le righe rifiutate si tolgono (con il loro messaggio) e le altre famiglie partono lo stesso.
    // Se il Test stesso non riesce (rete, errore del servizio) NON si invia alla cieca: nulla parte, si riprova al prossimo giro.
    try {
      const t = await wsTest(c.username!, token, send.map((s) => recordOf(s, maps)));
      const det = t.elenco.dettaglio;
      if (det.length === send.length) {
        const rejected = new Set<string>();
        for (let i = 0; i < send.length; i++) {
          if (!det[i].esito) { rejected.add(send[i].id); await admin.from("alloggiati_schedine").update({ errors: portalErrors(det[i]), stato: "da_validare" }).eq("id", send[i].id); }
        }
        if (rejected.size) { const r = sendableRows(send, [], rejected); held = [...held, ...r.held]; send = r.send; }
      }
    } catch (e) { throw new Error(`Controllo preliminare del portale non riuscito, nessuna schedina inviata (${(e as Error)?.message ?? "errore"}). Riprova più tardi.`); }

    if (!send.length) {
      res = { ok: false, message: `${held.length === 1 ? "Schedina non inviata" : "Schedine non inviate"}: ${held.length} rifiutate dal controllo del portale o con famiglia incompleta (vedi dettaglio schedine).` };
    } else {
      sendCalled = true;
      const { result, elenco } = await wsSend(c.username!, token, send.map((s) => recordOf(s, maps)));
      const perLine = evalSend(result.esito, elenco.dettaglio, send.length);
      accepted = send.filter((_, i) => perLine[i]);
      // Righe rifiutate dal portale: il motivo resta sulla schedina.
      for (let i = 0; i < send.length; i++) {
        const d = elenco.dettaglio[i];
        if (!perLine[i] && d && !d.esito) await admin.from("alloggiati_schedine").update({ errors: portalErrors(d), stato: "da_validare" }).eq("id", send[i].id);
      }
      const invalid = send.length - accepted.length;
      const ric = `RIC-${todayRome()}`;
      const tail = held.length ? ` ${held.length} non inviate (da correggere).` : "";
      res = {
        ok: result.esito && invalid === 0 && held.length === 0,
        message: (invalid ? `${accepted.length}/${send.length} acquisite, ${invalid} con errori.` : `${accepted.length === 1 ? "Inviata 1 schedina" : `Inviate ${accepted.length} schedine`} alla Questura.`) + tail,
        ricevuta: result.esito && accepted.length ? ric : undefined,
      };
    }
  } catch (e) { res = { ok: false, message: (e as Error)?.message ?? "Errore invio schedine." }; }

  if (sub?.id) {
    if (!sendCalled && !accepted.length) {
      // Nessun invio è partito (famiglie incomplete, righe rifiutate dal Test, errore prima del Send): niente riga "error" in archivio, altrimenti il cron ne crea una ogni sera.
      await admin.from("alloggiati_submissions").delete().eq("id", sub.id);
    } else {
      // Invio parziale (alcune acquisite, altre tenute indietro o con errori) = "sent": le righe errate restano sulle schedine, non sono un invio fallito.
      await admin.from("alloggiati_submissions").update({ stato: accepted.length ? "sent" : "error", esito: res.message, ricevuta: res.ricevuta ?? null, tentativi: 1, count: send.length }).eq("id", sub.id);
    }
  }
  // Segna come inviate le schedine effettivamente acquisite. Si marca per (prenotazione, ospite) e non per id: se nel frattempo syncSchedine ha rigenerato la riga
  // (id nuovo, ancora "pronta"), va segnata lei, altrimenti la schedina ripartirebbe alla Questura.
  const sentIds = accepted.map((s) => s.id);
  if (sentIds.length) {
    for (const s of accepted) {
      const upd = { stato: "inviata", submission_id: sub?.id ?? null, ricevuta: res.ricevuta ?? null };
      if (s.booking_id) await admin.from("alloggiati_schedine").update(upd).eq("tenant_id", tenantId).eq("booking_id", s.booking_id).eq("guest_ref", s.guest_ref ?? "primary").neq("stato", "inviata");
      else await admin.from("alloggiati_schedine").update(upd).eq("id", s.id);
    }
    const sentBookings = Array.from(new Set(accepted.map((s) => s.booking_id).filter(Boolean))) as string[];
    for (const bid of sentBookings) {
      await logBookingEvent(admin, tenantId, bid, "schedina", "Schedina Alloggiati inviata alla Questura");
    }
    // Protezione dati: adempimento concluso → rimuovi le foto del documento (il dato più
    // sensibile). Best-effort, non blocca l'esito dell'invio.
    try {
      const { purgeDocPhotos } = await import("./purge");
      await purgeDocPhotos(admin, tenantId, sentBookings);
    } catch { /* purga non critica */ }
  }
  return { ok: res.ok, message: res.message, sent: sentIds.length, blocked: held.length };
}
