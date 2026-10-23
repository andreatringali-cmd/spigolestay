import type { SupabaseClient } from "@supabase/supabase-js";

// Fase 3, passo 3a: scrittura LATO SERVER di una singola riga di public.entities, SPENTA DI DEFAULT.
//
// Oggi la verita' e' il blocco (app_state / org_state, chiave spigolestay:data:v1) e la tabella entities e' una copia che si aggiorna da sola col trigger
// blocco -> tabella. Questo modulo serve al giorno in cui, per UN proprietario e UN tipo di entita' (kind), la verita' passa alla tabella: la tabella
// public.entity_authority(owner_type, owner_id, kind, authority 'blob'|'table') dice chi comanda; se manca la riga o la tabella, comanda il blocco.
//
// Regola d'oro: l'helper scrive nella tabella SOLO se (1) l'interruttore SERVER_WRITE_ENTITIES=on E (2) per quel proprietario e quel kind l'autorita' e' 'table'.
// In ogni altro caso (interruttore spento, tabella entity_authority inesistente, riga assente, autorita' 'blob') non scrive nulla e restituisce { handled:false }:
// il chiamante prosegue col percorso di sempre (il blocco). Nessun proprietario e' 'table' oggi, quindi oggi questo modulo non cambia il comportamento di nessuno scrittore.
// ECCEZIONE (fail-closed): con l'interruttore ACCESO, se la lettura dell'autorita' va in errore (errore del database o eccezione; NON la tabella assente) non si sa se il blocco
// sia la verita': si risponde { handled:true, ok:false, error:"read_error" } e NON si scrive il blocco (il chiamante lo tratta come un conflitto/errore da ritentare).
// L'interruttore SPENTO resta «fail-open» per costruzione: vale solo se NESSUN proprietario ha righe 'table' (vedi docs/FASE3-STORE-DA-TABELLE.md).
//
// Una volta confermata l'autorita' 'table' l'helper NON ricade piu' sul blocco (non sarebbe piu' la verita': si creerebbero due versioni): non lancia mai,
// ma riporta { handled:true, ok:false, error } e il chiamante tratta il caso come un normale conflitto di scrittura (i webhook di Stripe/Channex ritentano).
//
// Concorrenza: ogni riga porta updated_ms (= updatedAt dell'entita', in ms). La scrittura e' un compare-and-set: UPDATE ... WHERE updated_ms = <valore letto>.
// Il nuovo updated_ms e' sempre strettamente maggiore del precedente, cosi' due scrittori non si sovrascrivono mai in silenzio. Colonne di comodo
// (structure_id, check_in, check_out, status, channel) sono ricalcolate dal dato come fa il trigger blocco -> tabella; le colonne delle prenotazioni
// (unit_id, guest_id, group_id, ota_code, ext_id) le ricalcola il trigger entities_bk_cols_trg della migrazione 0015.
// Istruzioni di accensione e di spegnimento: docs/FASE3-PASSO3A.md.

export type Json = Record<string, unknown>;
export type OwnerType = "u" | "o";
/** Le collezioni del blocco che hanno una riga in public.entities (nomi uguali alla colonna kind). */
export const WRITABLE_KINDS = ["structures", "roomTypes", "units", "bookings", "guests", "directReviews", "events"] as const;
export type WritableKind = (typeof WRITABLE_KINDS)[number];

/** Riga di public.entities come la leggono (e la scrivono) questi helper. Compatibile con EntityRow di server-entities.ts. */
export interface WriteRow {
  owner_type: string; owner_id: string; kind: string; id: string;
  structure_id?: string | null; data: unknown; updated_ms?: number | null;
}

export type NotHandledReason = "disabled" | "bad_input" | "authority_blob" | "authority_missing_table" | "authority_error";
export type WriteError = "conflict" | "not_found" | "read_error" | "write_error" | "unsupported_shape" | "writer_not_migrated";

const ENTITIES = "entities";
const AUTHORITY = "entity_authority";
const COLS = "owner_type,owner_id,kind,id,structure_id,data,updated_ms";
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? e)).slice(0, 300);
const isObj = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);

// ───────────────────────── interruttore e autorita' ─────────────────────────
/** Interruttore generale (letto a ogni chiamata, quindi si cambia con la variabile d'ambiente senza toccare il codice). Spento = nessuna chiamata a database. */
export function entitiesWriteEnabled(): boolean {
  return String(process.env.SERVER_WRITE_ENTITIES ?? "").trim().toLowerCase() === "on";
}

export type AuthorityReason = "disabled" | "row" | "no_row" | "missing_table" | "error";
export interface AuthorityInfo { authority: "blob" | "table"; reason: AuthorityReason; message?: string }

// La tabella entity_authority puo' non esistere ancora (migrazione 0017 non applicata): lo si ricorda per un minuto, per non ripetere una richiesta destinata a fallire a ogni scrittura.
const MISSING_TTL_MS = 60_000;
let missingUntil = 0;
/** Solo per i test: azzera la memoria di «tabella assente». */
export function _resetWriteState() { missingUntil = 0; }

const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table|schema cache/i.test(String(e.message ?? ""));

/**
 * Chi comanda per questo proprietario e questo kind? 'table' SOLO se la riga di entity_authority lo dice esplicitamente; in tutti gli altri casi 'blob'
 * (interruttore spento, tabella o riga assenti, valore diverso da 'table', errore di lettura). Non lancia mai.
 */
export async function readEntityAuthority(admin: SupabaseClient, ownerType: OwnerType, ownerId: string, kind: string): Promise<AuthorityInfo> {
  if (!entitiesWriteEnabled()) return { authority: "blob", reason: "disabled" };
  if (Date.now() < missingUntil) return { authority: "blob", reason: "missing_table" };
  try {
    const { data, error } = await admin.from(AUTHORITY).select("authority").eq("owner_type", ownerType).eq("owner_id", ownerId).eq("kind", kind).maybeSingle();
    if (error) {
      if (isMissingTable(error)) { missingUntil = Date.now() + MISSING_TTL_MS; return { authority: "blob", reason: "missing_table", message: errMsg(error) }; }
      return { authority: "blob", reason: "error", message: errMsg(error) };
    }
    if (!data) return { authority: "blob", reason: "no_row" };
    return { authority: (data as { authority?: unknown }).authority === "table" ? "table" : "blob", reason: "row" };
  } catch (e) {
    return { authority: "blob", reason: "error", message: errMsg(e) };
  }
}

/**
 * Quali tra `kinds` hanno per questo proprietario l'autorita' 'table'? UNA sola richiesta a entity_authority (per i lettori che ricostruiscono uno store dalle tabelle,
 * vedi server-entities-store.ts). Stessa regola di readEntityAuthority: interruttore spento = [] senza nessuna chiamata al database; tabella assente, nessuna riga,
 * valore diverso da 'table', errore o eccezione = [] (si resta sul blocco, come oggi). Non lancia mai.
 */
export async function readTableKinds(admin: SupabaseClient, ownerType: OwnerType, ownerId: string, kinds: readonly string[]): Promise<string[]> {
  return (await readTableKindsInfo(admin, ownerType, ownerId, kinds)).kinds;
}
/** Come readTableKinds ma dice anche se la lettura e' fallita (error valorizzato: errore o eccezione; la tabella assente NON e' un errore, vuol dire che nessuno e' 'table'). */
export async function readTableKindsInfo(admin: SupabaseClient, ownerType: OwnerType, ownerId: string, kinds: readonly string[]): Promise<{ kinds: string[]; error?: string }> {
  if (!entitiesWriteEnabled() || !ownerId || !kinds.length) return { kinds: [] };
  if (Date.now() < missingUntil) return { kinds: [] };
  try {
    const { data, error } = await admin.from(AUTHORITY).select("kind,authority").eq("owner_type", ownerType).eq("owner_id", ownerId).in("kind", [...kinds]);
    if (error) {
      if (isMissingTable(error)) { missingUntil = Date.now() + MISSING_TTL_MS; return { kinds: [] }; }
      return { kinds: [], error: errMsg(error) };
    }
    const want = new Set(kinds);
    return { kinds: arr(data).filter((r) => r.authority === "table" && want.has(String(r.kind))).map((r) => String(r.kind)) };
  } catch (e) {
    return { kinds: [], error: errMsg(e) };
  }
}

/** Gli altri tipi che uno scrittore di prenotazioni puo' leggere dal blocco intero (oltre a bookings). */
const SCOPE_OTHER_KINDS = ["structures", "roomTypes", "units", "guests"] as const;
const authReadFailed = (a: AuthorityInfo): { handled: true; ok: false; error: "read_error"; message: string } => ({ handled: true, ok: false, error: "read_error", message: "autorita': " + (a.message ?? "lettura non riuscita") });

const reasonOf = (a: AuthorityInfo): NotHandledReason =>
  a.reason === "disabled" ? "disabled" : a.reason === "missing_table" ? "authority_missing_table" : a.reason === "error" ? "authority_error" : "authority_blob";

// ───────────────────────── utilita' ─────────────────────────
/** JSON canonico (chiavi ordinate) senza updatedAt: due versioni «uguali» a parte il timbro non vanno riscritte. */
function contentKey(v: unknown): string {
  const norm = (x: unknown, top: boolean): unknown => {
    if (Array.isArray(x)) return x.map((y) => norm(y, false));
    if (x && typeof x === "object") {
      const o: Json = {};
      for (const k of Object.keys(x as Json).sort()) { if (top && k === "updatedAt") continue; o[k] = norm((x as Json)[k], false); }
      return o;
    }
    return x;
  };
  return JSON.stringify(norm(v, true));
}
const sameContent = (a: unknown, b: unknown) => contentKey(a) === contentKey(b);

/** L'entita' cosi' com'e' nel blocco (garantendo il campo id), copia profonda. */
function entityOf(row: WriteRow): Json {
  let d = row.data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = {}; } }
  const o = structuredClone(isObj(d) ? d : {});
  if (o.id == null || o.id === "") o.id = row.id;
  return o;
}

const safeDate = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(v) ? v.slice(0, 10) : null);
const strOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

/** Timbro monotono: updatedAt del dato (se gia' piu' recente del precedente) altrimenti max(adesso, precedente + 1). Aggiorna il dato e restituisce i ms. */
function stampNext(next: Json, prevMs: number, now: number): number {
  const u = typeof next.updatedAt === "number" && Number.isFinite(next.updatedAt) ? Math.floor(next.updatedAt) : 0;
  const ms = u > prevMs ? u : Math.max(now, prevMs + 1);
  next.updatedAt = ms;
  return ms;
}

const pk = (row: WriteRow) => ({ owner_type: row.owner_type, owner_id: row.owner_id, kind: row.kind, id: row.id });

type CasResult = { ok: true } | { ok: false; error: "conflict" | "write_error"; message?: string };
/** UPDATE della singola riga con compare-and-set su updated_ms. */
async function casUpdate(admin: SupabaseClient, row: WriteRow, next: Json, prevMs: number, newMs: number): Promise<CasResult> {
  const sid = strOrNull(next.structureId) ?? strOrNull(row.structure_id);
  const patch = {
    data: next, updated_ms: newMs, structure_id: sid,
    check_in: safeDate(next.checkIn), check_out: safeDate(next.checkOut), status: strOrNull(next.status), channel: strOrNull(next.channel),
    synced_at: new Date().toISOString(),
  };
  const k = pk(row);
  try {
    const { data, error } = await admin.from(ENTITIES).update(patch).eq("owner_type", k.owner_type).eq("owner_id", k.owner_id).eq("kind", k.kind).eq("id", k.id).eq("updated_ms", prevMs).select("updated_ms");
    if (error) return { ok: false, error: "write_error", message: errMsg(error) };
    return Array.isArray(data) && data.length > 0 ? { ok: true } : { ok: false, error: "conflict" };
  } catch (e) {
    return { ok: false, error: "write_error", message: errMsg(e) };
  }
}

interface Item { row: WriteRow; cur: Json; next: Json }
type WriteRowsResult = { ok: true; updatedMs: number[] } | { ok: false; error: "conflict" | "write_error"; message?: string };
/**
 * Scrive piu' righe una dopo l'altra, ognuna col suo compare-and-set. Se una fallisce, quelle gia' scritte vengono rimesse com'erano (anch'esse con compare-and-set).
 * NON e' una transazione: per le operazioni a piu' righe che devono essere atomiche servira' una funzione SQL (passo 3c); qui si copre il caso gruppo di camere.
 */
async function writeRows(admin: SupabaseClient, items: Item[], now: number): Promise<WriteRowsResult> {
  const done: { item: Item; prevMs: number; newMs: number }[] = [];
  for (const it of items) {
    const prevMs = Number(it.row.updated_ms ?? 0) || 0;
    const next = { ...it.next, id: it.row.id };
    const newMs = stampNext(next, prevMs, now);
    const r = await casUpdate(admin, it.row, next, prevMs, newMs);
    if (r.ok) { done.push({ item: it, prevMs, newMs }); continue; }
    for (const d of done.reverse()) {
      const back = { ...d.item.cur, id: d.item.row.id, updatedAt: d.newMs + 1 };
      const rb = await casUpdate(admin, d.item.row, back, d.newMs, d.newMs + 1);
      if (!rb.ok) console.error("[entities-write] ripristino non riuscito", d.item.row.kind, d.item.row.id, rb.error);
    }
    return r;
  }
  return { ok: true, updatedMs: done.map((d) => d.newMs) };
}

async function readOne(admin: SupabaseClient, ownerType: string, ownerId: string, kind: string, id: string): Promise<{ row: WriteRow | null; error?: string }> {
  const { data, error } = await admin.from(ENTITIES).select(COLS).eq("owner_type", ownerType).eq("owner_id", ownerId).eq("kind", kind).eq("id", id).maybeSingle();
  if (error) return { row: null, error: errMsg(error) };
  return { row: (data as WriteRow | null) ?? null };
}

// ───────────────────────── patchEntity: una riga ─────────────────────────
export interface PatchEntityArgs {
  ownerType: OwnerType;
  ownerId: string;
  /** Nome della collezione (bookings, guests, ...). */
  kind: string;
  id: string;
  /** Unione superficiale sull'entita' (come `{...entita, ...patch}` sul blocco). Alternativa a mutate. */
  patch?: Json;
  /** Riceve una copia dell'entita' e restituisce la nuova versione, oppure null/false se non c'e' nulla da scrivere. Deve essere ri-applicabile (viene rieseguita su dati freschi dopo un conflitto). */
  mutate?: (current: Json) => Json | null | false | undefined;
  /** Se indicato: la scrittura avviene solo se la riga ha ESATTAMENTE questo updated_ms (altrimenti conflict, senza ritentare). Se omesso: rilettura e fino a 3 tentativi. */
  expectUpdatedMs?: number;
  /** Solo per i test. */
  now?: number;
}
export type PatchResult =
  | { handled: false; reason: NotHandledReason }
  | { handled: true; ok: true; changed: boolean; updatedMs: number }
  | { handled: true; ok: false; error: WriteError; message?: string; currentUpdatedMs?: number };

const MAX_ATTEMPTS = 3;

/**
 * Aggiorna UNA riga di public.entities se per quel proprietario e quel kind l'autorita' e' 'table'; altrimenti { handled:false } e non scrive nulla.
 * Non lancia mai.
 */
export async function patchEntity(admin: SupabaseClient, args: PatchEntityArgs): Promise<PatchResult> {
  try {
    const okInput = (args.ownerType === "u" || args.ownerType === "o") && !!args.ownerId && !!args.id && (WRITABLE_KINDS as readonly string[]).includes(args.kind)
      && (!!args.patch !== !!args.mutate) && (args.patch === undefined || isObj(args.patch));
    if (!okInput) return { handled: false, reason: "bad_input" };
    const auth = await readEntityAuthority(admin, args.ownerType, args.ownerId, args.kind);
    if (auth.reason === "error") return authReadFailed(auth); // interruttore acceso ma autorita' illeggibile: NON si scrive il blocco (potrebbe non essere la verita')
    if (auth.authority !== "table") return { handled: false, reason: reasonOf(auth) };
    return await patchTable(admin, args);
  } catch (e) {
    // Prima di conoscere l'autorita' (sopra) un errore ricade sul blocco; qui l'autorita' e' 'table': niente ripiego sul blocco, si riporta l'errore.
    return { handled: true, ok: false, error: "write_error", message: errMsg(e) };
  }
}

async function patchTable(admin: SupabaseClient, a: PatchEntityArgs): Promise<PatchResult> {
  const attempts = a.expectUpdatedMs === undefined ? MAX_ATTEMPTS : 1;
  const now = a.now ?? Date.now();
  let last: PatchResult = { handled: true, ok: false, error: "conflict" };
  for (let i = 0; i < attempts; i++) {
    const { row, error } = await readOne(admin, a.ownerType, a.ownerId, a.kind, a.id);
    if (error) return { handled: true, ok: false, error: "read_error", message: error };
    if (!row) return { handled: true, ok: false, error: "not_found" };
    const prevMs = Number(row.updated_ms ?? 0) || 0;
    if (a.expectUpdatedMs !== undefined && prevMs !== a.expectUpdatedMs) return { handled: true, ok: false, error: "conflict", currentUpdatedMs: prevMs };
    const cur = entityOf(row);
    let next: Json | null | false | undefined;
    if (a.patch) next = { ...cur, ...a.patch };
    else next = a.mutate!(structuredClone(cur));
    if (!next || !isObj(next)) return { handled: true, ok: true, changed: false, updatedMs: prevMs };
    if (sameContent(cur, next)) return { handled: true, ok: true, changed: false, updatedMs: prevMs };
    const w = await writeRows(admin, [{ row, cur, next }], now);
    if (w.ok) return { handled: true, ok: true, changed: true, updatedMs: w.updatedMs[0] };
    last = { handled: true, ok: false, error: w.error, message: w.message, currentUpdatedMs: prevMs };
    if (w.error !== "conflict") return last;
  }
  return last;
}

// ───────────────────────── mutazione «a forma di blocco» su una prenotazione (e il suo gruppo) ─────────────────────────
export interface BookingScopeArgs {
  ownerType: OwnerType;
  ownerId: string;
  bookingId: string;
  /** La stessa funzione che oggi si passa a mutateStore: riceve un oggetto con `bookings` (la prenotazione al posto 0, poi le altre camere del gruppo) e `structures` (la sua struttura). */
  mutate: (data: Json, bookingIndex: number) => boolean;
  /** true = il chiamante e' stato verificato per questa forma ridotta dei dati. false = scrittore non ancora migrato: se l'autorita' e' 'table' si rifiuta (non si scrive il blocco). */
  supported: boolean;
  now?: number;
}
export type ScopeResult =
  | { handled: false; reason: NotHandledReason }
  | { handled: true; ok: true; wrote: boolean; skipped?: boolean }
  | { handled: true; ok: false; error: WriteError; message?: string };

/**
 * Per mutateStore (manage-booking.ts). Se l'autorita' di 'bookings' e' 'table': costruisce dalle righe un oggetto «data» ridotto (prenotazione + camere dello stesso
 * gruppo + struttura), esegue la funzione, e scrive SOLO le righe di prenotazione cambiate (compare-and-set, un nuovo tentativo su conflitto). Se la funzione tocca altro
 * (altre collezioni, righe aggiunte o tolte) non scrive niente e riporta unsupported_shape. Se l'autorita' non e' 'table': { handled:false }.
 */
export async function mutateBookingScope(admin: SupabaseClient, a: BookingScopeArgs): Promise<ScopeResult> {
  try {
    if (!a.ownerId || !a.bookingId || (a.ownerType !== "u" && a.ownerType !== "o")) return { handled: false, reason: "bad_input" };
    const auth = await readEntityAuthority(admin, a.ownerType, a.ownerId, "bookings");
    if (auth.reason === "error") return authReadFailed(auth);
    if (auth.authority !== "table") {
      // Uno scrittore non migrato lavora sul blocco intero: se UN QUALSIASI altro tipo che puo' usare (strutture, tipologie, camere, ospiti) ha autorita' 'table' il blocco
      // non lo contiene piu' e la funzione vedrebbe dati mancanti (importi sbagliati senza errore). Si rifiuta, come per le prenotazioni.
      if (!a.supported && auth.reason !== "disabled" && auth.reason !== "missing_table") {
        const other = await readTableKindsInfo(admin, a.ownerType, a.ownerId, SCOPE_OTHER_KINDS);
        if (other.error) return { handled: true, ok: false, error: "read_error", message: other.error };
        if (other.kinds.length) return { handled: true, ok: false, error: "writer_not_migrated", message: "autorita' table su " + other.kinds.join(",") };
      }
      return { handled: false, reason: reasonOf(auth) };
    }
    if (!a.supported) return { handled: true, ok: false, error: "writer_not_migrated" };
    return await scopeTable(admin, a);
  } catch (e) {
    return { handled: true, ok: false, error: "write_error", message: errMsg(e) };
  }
}

async function scopeTable(admin: SupabaseClient, a: BookingScopeArgs): Promise<ScopeResult> {
  const now = a.now ?? Date.now();
  let last: ScopeResult = { handled: true, ok: false, error: "conflict" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await readOne(admin, a.ownerType, a.ownerId, "bookings", a.bookingId);
    if (t.error) return { handled: true, ok: false, error: "read_error", message: t.error };
    if (!t.row) return { handled: true, ok: false, error: "not_found" };
    const target = entityOf(t.row);
    let rows: WriteRow[] = [t.row];
    const gid = strOrNull(target.groupId);
    if (gid) {
      const { data, error } = await admin.from(ENTITIES).select(COLS).eq("owner_type", a.ownerType).eq("owner_id", a.ownerId).eq("kind", "bookings").eq("data->>groupId", gid);
      if (error) return { handled: true, ok: false, error: "read_error", message: errMsg(error) };
      rows = [t.row, ...(Array.isArray(data) ? (data as WriteRow[]) : []).filter((r) => r.id !== t.row!.id)];
    }
    const sid = strOrNull(target.structureId);
    let structures: Json[] = [];
    if (sid) {
      const s = await readOne(admin, a.ownerType, a.ownerId, "structures", sid);
      if (s.error) return { handled: true, ok: false, error: "read_error", message: s.error };
      if (s.row) structures = [entityOf(s.row)];
    }
    const before = rows.map(entityOf);
    const data: Json = { bookings: structuredClone(before), structures: structuredClone(structures) };
    if (!a.mutate(data, 0)) return { handled: true, ok: true, wrote: false, skipped: true };
    const after = arr(data.bookings);
    const keys = Object.keys(data).sort().join(",");
    if (keys !== "bookings,structures" || after.length !== before.length || after.some((b, i) => String(b?.id ?? "") !== String(before[i].id)) || !sameContent(data.structures, structures)) {
      return { handled: true, ok: false, error: "unsupported_shape" };
    }
    const items: Item[] = [];
    rows.forEach((row, i) => { if (!sameContent(before[i], after[i])) items.push({ row, cur: before[i], next: after[i] }); });
    if (!items.length) return { handled: true, ok: true, wrote: false };
    const w = await writeRows(admin, items, now);
    if (w.ok) return { handled: true, ok: true, wrote: true };
    last = { handled: true, ok: false, error: w.error, message: w.message };
    if (w.error !== "conflict") return last;
  }
  return last;
}

// ───────────────────────── insieme di righe scelte dal chiamante (riconciliazione Stripe) ─────────────────────────
export type SetPlan = { action: "none" } | { action: "noop" } | { action: "changes"; changes: { idx: number; next: Json }[] };
export interface EntitySetArgs {
  ownerType: OwnerType;
  ownerId: string;
  kind: string;
  /** Carica le righe candidate (devono essere del proprietario indicato). Rieseguita su conflitto. */
  load: () => Promise<WriteRow[]>;
  /** Riceve le entita' candidate (stesso ordine delle righe) e decide cosa riscrivere (idx = posizione nell'elenco). */
  compute: (current: Json[]) => SetPlan;
  now?: number;
}
export type SetResult =
  | { handled: false; reason: NotHandledReason }
  | { handled: true; outcome: "ok" | "none" | "conflict" | "error"; message?: string };

/** Come patchEntity ma su un insieme di righe trovato dal chiamante. Esiti: none = nessuna riga pertinente, ok = riscritte (o gia' a posto), conflict/error = da ritentare. */
export async function mutateEntitySet(admin: SupabaseClient, a: EntitySetArgs): Promise<SetResult> {
  try {
    if (!a.ownerId || (a.ownerType !== "u" && a.ownerType !== "o") || !(WRITABLE_KINDS as readonly string[]).includes(a.kind)) return { handled: false, reason: "bad_input" };
    const auth = await readEntityAuthority(admin, a.ownerType, a.ownerId, a.kind);
    if (auth.reason === "error") return { handled: true, outcome: "error", message: "read_error: " + (auth.message ?? "") };
    if (auth.authority !== "table") return { handled: false, reason: reasonOf(auth) };
    const now = a.now ?? Date.now();
    let outcome: SetResult = { handled: true, outcome: "conflict" };
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = (await a.load()).filter((r) => r.owner_type === a.ownerType && r.owner_id === a.ownerId && r.kind === a.kind);
      const cur = rows.map(entityOf);
      const plan = a.compute(structuredClone(cur));
      if (plan.action === "none") return { handled: true, outcome: "none" };
      if (plan.action === "noop" || !plan.changes.length) return { handled: true, outcome: "ok" };
      const items: Item[] = [];
      for (const c of plan.changes) { if (rows[c.idx] && isObj(c.next) && !sameContent(cur[c.idx], c.next)) items.push({ row: rows[c.idx], cur: cur[c.idx], next: c.next }); }
      if (!items.length) return { handled: true, outcome: "ok" };
      const w = await writeRows(admin, items, now);
      if (w.ok) return { handled: true, outcome: "ok" };
      outcome = { handled: true, outcome: w.error === "conflict" ? "conflict" : "error", message: w.message };
      if (w.error !== "conflict") return outcome;
    }
    return outcome;
  } catch (e) {
    return { handled: true, outcome: "error", message: errMsg(e) };
  }
}
