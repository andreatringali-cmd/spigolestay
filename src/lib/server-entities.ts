import type { SupabaseClient } from "@supabase/supabase-js";

// Lettura LATO SERVER dalle tabelle (public.entities) al posto dei blocchi interi (app_state / org_state, chiave "spigolestay:data:v1").
// SOLO LETTURA: nessuno scrittore passa di qui, le scritture restano al blocco (la tabella si aggiorna da sola col trigger blocco -> tabella).
//
// Interruttore (variabile d'ambiente SERVER_READ_ENTITIES, letta a ogni chiamata, quindi si cambia senza ricompilare):
//   "off"     (default, o qualunque altro valore) = comportamento identico a prima: si legge SOLO il blocco, nessuna chiamata alle tabelle;
//   "compare" = si legge il blocco come prima E le tabelle, si confrontano e le differenze finiscono in console come JSON con prefisso
//               [entities-compare]; il risultato restituito e' SEMPRE quello del blocco (nessun effetto per gli utenti);
//   "on"      = il risultato e' quello delle tabelle (se la lettura delle tabelle va in errore si ripiega sul blocco e lo si segnala).
// Dettagli e istruzioni operative: src/lib/SERVER-ENTITIES.md.
//
// Forma della tabella (supabase/db-snapshot/2026-10-21-entities-state.md): chiave (owner_type, owner_id, kind, id); owner_type 'u' = utente
// (app_state), 'o' = organizzazione (org_state); kind = nome della collezione del blocco (structures, roomTypes, units, bookings, guests,
// directReviews, events); data = l'entita' cosi' com'e' nel blocco; colonne di comodo structure_id, check_in, check_out, status, channel, updated_ms.
// La migrazione 0015 aggiunge le colonne ota_code, unit_id, guest_id, group_id e i kind rates / activities / tombs / leadtombs: questo modulo
// funziona anche PRIMA (ripiego su data->>'campo' con il vincolo sul kind) e usa le colonne nuove appena esistono (rilevate una volta per processo).

export const DATA_KEY = "spigolestay:data:v1";
export type Json = Record<string, unknown>;
export type EntityOwner = { type: "u" | "o"; id: string };
export const ENTITY_KINDS = ["structures", "roomTypes", "units", "bookings", "guests", "directReviews", "events"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
/** Le cinque collezioni che oggi leggono loadOrgDatas / mergeOrgData (concierge-orgdata.ts). */
export const MERGE_KINDS: EntityKind[] = ["structures", "roomTypes", "units", "bookings", "guests"];

export interface EntityRow {
  owner_type: string; owner_id: string; kind: string; id: string; structure_id?: string | null; data: unknown; updated_ms?: number | null;
  check_in?: string | null; check_out?: string | null; status?: string | null; channel?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const str = (x: unknown): string => (x == null ? "" : String(x));
const COLS = "owner_type,owner_id,kind,id,structure_id,data,updated_ms,check_in,check_out,status,channel";
const tbl = (admin: SupabaseClient): Q => admin.from("entities");

// ───────────────────────── interruttore e registro delle differenze ─────────────────────────
export type EntitiesReadMode = "off" | "compare" | "on";
export function entitiesReadMode(): EntitiesReadMode {
  const v = String(process.env.SERVER_READ_ENTITIES ?? "").trim().toLowerCase();
  return v === "compare" || v === "on" ? v : "off";
}

type LogFn = (level: "info" | "warn", line: string) => void;
const defaultLog: LogFn = (level, line) => { if (level === "warn") console.warn(line); else console.log(line); };
let logFn: LogFn = defaultLog;
const okAt = new Map<string, number>();
const OK_EVERY_MS = 10 * 60_000;
/** Solo per i test: sostituisce (o ripristina, con null) la destinazione dei messaggi [entities-compare] e azzera il limitatore delle righe "ok". */
export function _setEntitiesLogger(fn: LogFn | null) { logFn = fn ?? defaultLog; okAt.clear(); }

/** Registra un evento del confronto: sempre una riga JSON con prefisso [entities-compare]. */
export function logCompare(level: "info" | "warn", payload: Json) {
  try { logFn(level, "[entities-compare] " + JSON.stringify({ ts: new Date().toISOString(), ...payload })); } catch { /* il registro non deve mai rompere una richiesta */ }
}
function logOk(label: string) {
  const now = Date.now();
  if ((okAt.get(label) ?? 0) + OK_EVERY_MS > now) return; // le righe "tutto uguale" al massimo una ogni 10 minuti per punto: i log restano leggibili
  okAt.set(label, now);
  logCompare("info", { label, result: "ok" });
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Cuore dell'interruttore. `legacy` legge dal blocco (comportamento di sempre), `tables` dalle tabelle.
 *  off: solo legacy. compare: legacy + tables, differenze nel registro, restituisce legacy. on: tables (ripiego su legacy se le tabelle vanno in errore).
 *  `project` riduce il risultato alla parte da confrontare; `diff` ritorna null se uguali, altrimenti un riassunto (di default confronta il JSON).
 */
export async function entitiesSwitch<T>(opts: {
  label: string;
  legacy: () => Promise<T>;
  tables: (mode: "compare" | "on") => Promise<T>;
  project?: (v: T) => unknown;
  diff?: (a: T, b: T) => Json | null;
}): Promise<T> {
  const mode = entitiesReadMode();
  if (mode === "off") return opts.legacy();
  if (mode === "compare") {
    const fromBlock = await opts.legacy();
    try {
      const fromTables = await opts.tables("compare");
      const project = opts.project ?? ((v: T) => v);
      const d = opts.diff ? opts.diff(fromBlock, fromTables) : diffValues(project(fromBlock), project(fromTables));
      if (d) logCompare("warn", { label: opts.label, result: "diff", ...d }); else logOk(opts.label);
    } catch (e) {
      logCompare("warn", { label: opts.label, result: "error", message: errMsg(e) });
    }
    return fromBlock;
  }
  try {
    return await opts.tables("on");
  } catch (e) {
    logCompare("warn", { label: opts.label, result: "fallback_to_block", message: errMsg(e) });
    return opts.legacy();
  }
}

/** Solo per i punti dove la lettura e' legata a una scrittura del blocco, o non ancora promossa a "on": in "compare" confronta e registra, in "off" e "on" non fa nulla (vale il blocco).
 *  `diff` facoltativo: un confronto per id (diffBlockParts) invece che sul JSON intero. */
export async function entitiesShadow<T>(label: string, fromBlock: T, tables: () => Promise<T>, project?: (v: T) => unknown, diff?: (a: T, b: T) => Json | null): Promise<void> {
  if (entitiesReadMode() !== "compare") return;
  try {
    const fromTables = await tables();
    const p = project ?? ((v: T) => v);
    const d = diff ? diff(fromBlock, fromTables) : diffValues(p(fromBlock), p(fromTables));
    if (d) logCompare("warn", { label, result: "diff", ...d }); else logOk(label);
  } catch (e) {
    logCompare("warn", { label, result: "error", message: errMsg(e) });
  }
}

// ───────────────────────── confronto ─────────────────────────
/** JSON canonico (chiavi ordinate) per confrontare due valori a prescindere dall'ordine delle chiavi. */
export function canonical(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") { const o: Json = {}; for (const k of Object.keys(x as Json).sort()) o[k] = norm((x as Json)[k]); return o; }
    return x;
  };
  return JSON.stringify(norm(v));
}
/** null se uguali; altrimenti un riassunto breve (valori troncati). */
export function diffValues(a: unknown, b: unknown): Json | null {
  const ca = canonical(a), cb = canonical(b);
  if (ca === cb) return null;
  return { block: (ca ?? "undefined").slice(0, 300), tables: (cb ?? "undefined").slice(0, 300) };
}

const entId = (it: unknown): string => (it && typeof it === "object" && (it as Json).id != null && (it as Json).id !== "" ? String((it as Json).id) : "");
const mapById = (parts: Json[], kind: string): Map<string, string> => {
  const m = new Map<string, string>();
  for (const p of parts) for (const it of arr(p?.[kind])) { const c = canonical(it); m.set(entId(it) || c, c); }
  return m;
};
const mergedRates = (parts: Json[]): Json => {
  const out: Json = {};
  for (const p of parts) if (p?.rateOverrides && typeof p.rateOverrides === "object") Object.assign(out, p.rateOverrides as Json);
  return out;
};

/**
 * Confronta due insiemi di «dati del blocco» (uno per proprietario) collezione per collezione, a prescindere dall'ordine e da come sono divisi tra le parti.
 * null = uguali. Altrimenti { colls: { bookings: { block: n, tables: n, onlyBlock: [id…], onlyTables: [id…], changed: [id…], fields: [campi…] } }, rates?: … }.
 */
export function diffBlockParts(block: Json[], tables: Json[], kinds: readonly string[], opts: { rates?: boolean } = {}): Json | null {
  const colls: Json = {};
  for (const kind of kinds) {
    const A = mapById(block, kind), B = mapById(tables, kind);
    const onlyBlock: string[] = [], onlyTables: string[] = [], changed: string[] = [];
    for (const [id, c] of A) { const o = B.get(id); if (o === undefined) onlyBlock.push(id); else if (o !== c) changed.push(id); }
    for (const id of B.keys()) if (!A.has(id)) onlyTables.push(id);
    if (!onlyBlock.length && !onlyTables.length && !changed.length) continue;
    const fields = new Set<string>();
    for (const id of changed.slice(0, 3)) {
      const x = JSON.parse(A.get(id) as string) as Json, y = JSON.parse(B.get(id) as string) as Json;
      for (const k of new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])) if (canonical(x?.[k]) !== canonical(y?.[k])) fields.add(k);
    }
    colls[kind] = { block: A.size, tables: B.size, onlyBlock: onlyBlock.slice(0, 10), onlyTables: onlyTables.slice(0, 10), changed: changed.slice(0, 10), fields: [...fields].slice(0, 12), total: onlyBlock.length + onlyTables.length + changed.length };
  }
  const out: Json = {};
  if (Object.keys(colls).length) out.colls = colls;
  if (opts.rates) {
    const ra = mergedRates(block), rb = mergedRates(tables);
    const ka = Object.keys(ra), kb = Object.keys(rb);
    const diffKeys = [...new Set([...ka, ...kb])].filter((k) => canonical(ra[k]) !== canonical(rb[k]));
    if (diffKeys.length) out.rates = { block: ka.length, tables: kb.length, differing: diffKeys.slice(0, 10), total: diffKeys.length };
  }
  return Object.keys(out).length ? out : null;
}

// ───────────────────────── rilevamento delle colonne nuove (migrazione 0015) ─────────────────────────
export interface EntityFeatures { ota_code: boolean; unit_id: boolean; guest_id: boolean; group_id: boolean }
const FEATURE_COLS: (keyof EntityFeatures)[] = ["ota_code", "unit_id", "guest_id", "group_id"];
const NO_FEATURES: EntityFeatures = { ota_code: false, unit_id: false, guest_id: false, group_id: false };
let featuresP: Promise<{ f: EntityFeatures; definitive: boolean }> | null = null;

const columnMissing = (e: { code?: string; message?: string }) => e.code === "42703" || e.code === "PGRST204" || /does not exist|could not find|unknown column|no such column/i.test(str(e.message));
async function probeFeatures(admin: SupabaseClient): Promise<{ f: EntityFeatures; definitive: boolean }> {
  const f: EntityFeatures = { ...NO_FEATURES };
  let definitive = true;
  await Promise.all(FEATURE_COLS.map(async (col) => {
    try {
      const { error } = await tbl(admin).select(col).limit(1);
      if (!error) f[col] = true; else if (!columnMissing(error)) definitive = false; // errore diverso (rete, permessi): non e' una risposta sulla colonna, si ritenta alla prossima chiamata
    } catch { definitive = false; }
  }));
  return { f, definitive };
}
/** Quali colonne nuove esistono. Una sola sonda per processo (si ripete solo se la sonda ha dato un errore non definitivo). */
export async function entityFeatures(admin: SupabaseClient): Promise<EntityFeatures> {
  if (!featuresP) {
    const p = probeFeatures(admin);
    featuresP = p;
    p.then((r) => { if (!r.definitive && featuresP === p) featuresP = null; }, () => { if (featuresP === p) featuresP = null; });
  }
  return (await featuresP).f;
}
/** Solo per i test: dimentica il rilevamento fatto. */
export function _resetEntityFeatures() { featuresP = null; }
const anyNewColumns = (f: EntityFeatures) => f.ota_code || f.unit_id || f.guest_id || f.group_id;
const JSON_FIELD: Record<keyof EntityFeatures, string> = { ota_code: "code", unit_id: "unitId", guest_id: "guestId", group_id: "groupId" };
/** Colonna indicizzata se esiste, altrimenti il campo dentro data (sempre con il vincolo sul kind messo dal chiamante). */
const colOrJson = (f: EntityFeatures, key: keyof EntityFeatures): string => (f[key] ? key : "data->>" + JSON_FIELD[key]);

// ───────────────────────── lettura per kind e finestra ─────────────────────────
const PAGE = 1000;       // PostgREST taglia a 1000 righe per richiesta: si legge a pagine
const MAX_ROWS = 200_000;
async function pageAll(build: () => Q): Promise<EntityRow[]> {
  const out: EntityRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order("owner_id", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error("entities: " + str(error.message));
    const rows = (Array.isArray(data) ? data : []) as EntityRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    if (out.length >= MAX_ROWS) throw new Error("entities: troppe righe");
  }
  return out;
}
const chunks = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** L'entita' cosi' com'era nel blocco (garantendo il campo id). */
export function entityData(row: EntityRow): Json {
  let d = row.data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = {}; } }
  const o = (d && typeof d === "object" && !Array.isArray(d) ? d : {}) as Json;
  return o.id == null || o.id === "" ? { ...o, id: row.id } : o;
}

export interface ReadOpts {
  structureId?: string;
  ids?: string[];
  /** Prenotazioni: sovrapposizione INCLUSIVA con [from, to] (YYYY-MM-DD): check_out >= from e check_in <= to. */
  from?: string; to?: string;
  statuses?: string[];
  unitId?: string; guestId?: string; groupId?: string;
}

/** Righe grezze di un kind di un proprietario, con i filtri indicati (le colonne nuove se esistono, altrimenti data->>campo). */
export async function readEntityRows(admin: SupabaseClient, owner: EntityOwner, kind: EntityKind | string, opts: ReadOpts = {}): Promise<EntityRow[]> {
  const needsF = !!(opts.unitId || opts.guestId || opts.groupId);
  const f = needsF ? await entityFeatures(admin) : NO_FEATURES;
  const base = (): Q => {
    let q = tbl(admin).select(COLS).eq("owner_type", owner.type).eq("owner_id", owner.id).eq("kind", kind);
    if (opts.structureId) q = q.eq("structure_id", opts.structureId);
    if (opts.from) q = q.gte("check_out", opts.from);
    if (opts.to) q = q.lte("check_in", opts.to);
    if (opts.statuses?.length) q = q.in("status", opts.statuses);
    if (opts.unitId) q = q.eq(colOrJson(f, "unit_id"), opts.unitId);
    if (opts.guestId) q = q.eq(colOrJson(f, "guest_id"), opts.guestId);
    if (opts.groupId) q = q.eq(colOrJson(f, "group_id"), opts.groupId);
    return q;
  };
  if (opts.ids) {
    const out: EntityRow[] = [];
    for (const part of chunks([...new Set(opts.ids.map(String))], 100)) out.push(...(await pageAll(() => base().in("id", part))));
    return out;
  }
  return pageAll(base);
}

const byOrder = (a: Json, b: Json) => {
  const x = typeof a.order === "number" ? a.order : Number.POSITIVE_INFINITY, y = typeof b.order === "number" ? b.order : Number.POSITIVE_INFINITY;
  return x === y ? 0 : x < y ? -1 : 1; // ordine scelto dall'utente (campo order); a parita' resta l'ordine per id
};
const dataOf = async (p: Promise<EntityRow[]>): Promise<Json[]> => (await p).map(entityData);

export const readStructures = async (admin: SupabaseClient, owner: EntityOwner): Promise<Json[]> => (await dataOf(readEntityRows(admin, owner, "structures"))).sort(byOrder);
export const readRoomTypes = async (admin: SupabaseClient, owner: EntityOwner, opts: { structureId?: string } = {}): Promise<Json[]> => (await dataOf(readEntityRows(admin, owner, "roomTypes", opts))).sort(byOrder);
export const readUnits = async (admin: SupabaseClient, owner: EntityOwner, opts: { structureId?: string } = {}): Promise<Json[]> => (await dataOf(readEntityRows(admin, owner, "units", opts))).sort(byOrder);
export const readBookings = (admin: SupabaseClient, owner: EntityOwner, opts: ReadOpts = {}): Promise<Json[]> => dataOf(readEntityRows(admin, owner, "bookings", opts));
export const readGuests = (admin: SupabaseClient, owner: EntityOwner): Promise<Json[]> => dataOf(readEntityRows(admin, owner, "guests"));
export const readGuestsByIds = (admin: SupabaseClient, owner: EntityOwner, ids: string[]): Promise<Json[]> => (ids.length ? dataOf(readEntityRows(admin, owner, "guests", { ids })) : Promise.resolve([]));
export const readDirectReviews = (admin: SupabaseClient, owner: EntityOwner, opts: { structureId?: string } = {}): Promise<Json[]> => dataOf(readEntityRows(admin, owner, "directReviews", opts));
export const readEvents = (admin: SupabaseClient, owner: EntityOwner, opts: { structureId?: string } = {}): Promise<Json[]> => dataOf(readEntityRows(admin, owner, "events", opts));

/** La struttura `sid` tra i proprietari indicati (una sola richiesta): mappa "u:<id>" / "o:<id>" -> entita'. Chi non la possiede non compare. */
export async function readStructureAcrossOwners(admin: SupabaseClient, owners: EntityOwner[], sid: string): Promise<Map<string, Json>> {
  const out = new Map<string, Json>();
  if (!owners.length || !sid) return out;
  const ids = [...new Set(owners.map((o) => o.id))];
  const rows = await pageAll(() => tbl(admin).select(COLS).eq("kind", "structures").eq("id", sid).in("owner_id", ids));
  for (const r of rows) out.set((r.owner_type === "o" ? "o" : "u") + ":" + r.owner_id, entityData(r));
  return out;
}

/** Ospiti di un proprietario con quella email (senza distinguere maiuscole) o, se non c'e' email, quel telefono. */
export async function findGuestsByContact(admin: SupabaseClient, owner: EntityOwner, c: { email?: string; phone?: string }): Promise<Json[]> {
  const email = str(c.email).trim(), phone = str(c.phone).trim();
  const field = email ? "data->>email" : phone ? "data->>phone" : "";
  if (!field) return [];
  const esc = (email || phone).replace(/[\\%_]/g, "\\$&"); // ilike: i caratteri jolly del valore vanno protetti
  const rows = await pageAll(() => tbl(admin).select(COLS).eq("owner_type", owner.type).eq("owner_id", owner.id).eq("kind", "guests").ilike(field, esc));
  return rows.map(entityData);
}

// ───────────────────────── ricerca di una prenotazione (senza conoscere il proprietario) ─────────────────────────
export interface BookingHit { owner: EntityOwner; booking: Json; row: EntityRow }
const toHit = (row: EntityRow): BookingHit => ({ owner: { type: row.owner_type === "o" ? "o" : "u", id: str(row.owner_id) }, booking: entityData(row), row });
// Come nel blocco: le organizzazioni prima del personale (fonte di verita' per le strutture in societa').
const orgFirst = (a: BookingHit, b: BookingHit) => (a.owner.type === b.owner.type ? 0 : a.owner.type === "o" ? -1 : 1);
async function lookupBookings(admin: SupabaseClient, decorate: (q: Q) => Q): Promise<BookingHit[]> {
  const { data, error } = await decorate(tbl(admin).select(COLS).eq("kind", "bookings")).limit(50);
  if (error) throw new Error("entities: " + str(error.message));
  return ((Array.isArray(data) ? data : []) as EntityRow[]).map(toHit).sort(orgFirst);
}

/** Per id prenotazione (colonna id, parte della chiave primaria). */
export async function findBookingsById(admin: SupabaseClient, id: string): Promise<BookingHit[]> {
  if (!id) return [];
  return lookupBookings(admin, (q) => q.eq("id", id));
}
/** Per codice dell'OTA (numero di prenotazione del portale): colonna ota_code se esiste, altrimenti data->>code. Facoltativo il filtro per struttura. */
export async function findBookingsByOtaCode(admin: SupabaseClient, code: string, opts: { structureId?: string } = {}): Promise<BookingHit[]> {
  const c = str(code).trim();
  if (!c) return [];
  const f = await entityFeatures(admin);
  return lookupBookings(admin, (q) => { let r = q.eq(colOrJson(f, "ota_code"), c); if (opts.structureId) r = r.eq("structure_id", opts.structureId); return r; });
}
/** Per codice Xenora (es. XEN-2026-0001, campo code della prenotazione), senza distinguere maiuscole. */
export async function findBookingsByXenoraCode(admin: SupabaseClient, code: string, opts: { structureId?: string } = {}): Promise<BookingHit[]> {
  const c = str(code).trim();
  if (!c) return [];
  const esc = c.replace(/[\\%_]/g, "\\$&");
  return lookupBookings(admin, (q) => { let r = q.ilike("data->>code", esc); if (opts.structureId) r = r.eq("structure_id", opts.structureId); return r; });
}
/** Per id esterno (extId: UID iCal, "channex:…", "site:slug:token", "stripe:sessione"). */
export async function findBookingsByExtId(admin: SupabaseClient, extId: string): Promise<BookingHit[]> {
  if (!extId) return [];
  return lookupBookings(admin, (q) => q.eq("data->>extId", extId));
}
/** Prenotazioni che citano un payment intent Stripe (pagamento principale o in stripeExtraPayments). */
export async function findBookingsByPaymentIntent(admin: SupabaseClient, pi: string): Promise<BookingHit[]> {
  if (!pi) return [];
  const [a, b] = await Promise.all([
    lookupBookings(admin, (q) => q.eq("data->>stripePaymentIntent", pi)),
    lookupBookings(admin, (q) => q.contains("data->stripeExtraPayments", [{ pi }])),
  ]);
  const seen = new Set<string>();
  return [...a, ...b].filter((h) => { const k = h.owner.type + h.owner.id + h.row.id; if (seen.has(k)) return false; seen.add(k); return true; }).sort(orgFirst);
}

// ───────────────────────── prezzi forzati, registro attivita', lapidi (kind della migrazione 0015) ─────────────────────────
export const ownerState = (o: EntityOwner) => (o.type === "o" ? ({ table: "org_state", keyCol: "org_id" } as const) : ({ table: "app_state", keyCol: "user_id" } as const));

/** rateOverrides letti dal blocco (ripiego finche' i kind della 0015 non sono popolati). */
async function rateOverridesFromBlock(admin: SupabaseClient, owner: EntityOwner): Promise<Record<string, number>> {
  const { table, keyCol } = ownerState(owner);
  const { data: row, error } = await admin.from(table).select("data").eq(keyCol, owner.id).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  try {
    const blob = ((row as { data?: unknown } | null)?.data ?? {}) as Record<string, string>;
    const d = JSON.parse(blob[DATA_KEY] || "{}") as Json;
    return (d.rateOverrides && typeof d.rateOverrides === "object" ? d.rateOverrides : {}) as Record<string, number>;
  } catch { return {}; }
}
const rateValue = (d: unknown): number | null => {
  if (typeof d === "number" && Number.isFinite(d)) return d;
  if (d && typeof d === "object") { for (const k of ["price", "value", "amount"]) { const v = (d as Json)[k]; if (typeof v === "number" && Number.isFinite(v)) return v; } }
  return null;
};
/**
 * Prezzi forzati ("roomTypeId|AAAA-MM-GG" -> prezzo). Dal kind `rates` se la migrazione 0015 e' applicata E ci sono righe per il proprietario;
 * altrimenti (nessuna riga: kind non ancora popolato, oppure davvero nessun prezzo forzato) dal blocco, che e' sempre corretto.
 */
export async function readRateOverrides(admin: SupabaseClient, owner: EntityOwner): Promise<{ map: Record<string, number>; source: "tables" | "block" }> {
  if (anyNewColumns(await entityFeatures(admin))) {
    const rows = await readEntityRows(admin, owner, "rates");
    if (rows.length) {
      const map: Record<string, number> = {};
      for (const r of rows) { const v = rateValue(r.data); if (v !== null) map[r.id] = v; }
      return { map, source: "tables" };
    }
  }
  return { map: await rateOverridesFromBlock(admin, owner), source: "block" };
}

// Riga di lapide: id "collezione|idEntita'" (anche con ":" o "/"), oppure data { coll | collection, id | eid }.
function tombFromRow(r: EntityRow): { coll: string; id: string } | null {
  const d = (r.data && typeof r.data === "object" ? r.data : {}) as Json;
  const c = str(d.coll ?? d.collection), i = str(d.eid ?? d.entityId ?? d.id);
  if (c && i && i !== r.id) return { coll: c, id: i };
  const m = /^([^|:/]+)[|:/](.+)$/.exec(r.id);
  return m ? { coll: m[1], id: m[2] } : null;
}

export interface BlockExtras { rateOverrides?: Record<string, number>; activities?: Json[]; _deleted?: Record<string, string[]>; _deletedLeads?: string[] }
/** I campi del blocco che non sono entita' vere. Solo se le colonne/kind della 0015 esistono; prima non c'e' nulla da ricostruire (resta nel blocco). */
export async function readBlockExtras(admin: SupabaseClient, owner: EntityOwner): Promise<BlockExtras> {
  if (!anyNewColumns(await entityFeatures(admin))) return {};
  const [rates, acts, tombs, leads] = await Promise.all([
    readRateOverrides(admin, owner),
    readEntityRows(admin, owner, "activities"),
    readEntityRows(admin, owner, "tombs"),
    readEntityRows(admin, owner, "leadtombs"),
  ]);
  const _deleted: Record<string, string[]> = {};
  for (const t of tombs) { const x = tombFromRow(t); if (x) (_deleted[x.coll] ??= []).push(x.id); }
  const activities = acts.map(entityData).sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
  return { rateOverrides: rates.map, activities, _deleted, _deletedLeads: leads.map((r) => r.id) };
}

// ───────────────────────── ricostruzione dell'oggetto «data» del blocco ─────────────────────────
export interface BlockOpts {
  /** Collezioni da leggere (default: tutte e sette). */
  kinds?: EntityKind[];
  /** Aggiunge rateOverrides (dal kind rates o, se non ancora popolato, dal blocco). */
  rateOverrides?: boolean;
  /** Aggiunge anche activities, _deleted, _deletedLeads (solo con la migrazione 0015). */
  extras?: boolean;
}
/**
 * Oggetto compatibile con quello di JSON.parse(blob["spigolestay:data:v1"]) di UN proprietario: le collezioni come liste di entita',
 * e su richiesta rateOverrides / activities / _deleted / _deletedLeads. Stessa forma che si fonde con mergeOrgData() (concierge-orgdata.ts).
 */
export async function buildBlockData(admin: SupabaseClient, owner: EntityOwner, opts: BlockOpts = {}): Promise<Json> {
  const kinds = opts.kinds ?? [...ENTITY_KINDS];
  const out: Json = {};
  const lists = await Promise.all(kinds.map((k) => (k === "structures" ? readStructures(admin, owner) : k === "roomTypes" ? readRoomTypes(admin, owner) : k === "units" ? readUnits(admin, owner) : dataOf(readEntityRows(admin, owner, k)))));
  kinds.forEach((k, i) => { out[k] = lists[i]; });
  if (opts.extras) {
    const x = await readBlockExtras(admin, owner);
    if (x.rateOverrides) out.rateOverrides = x.rateOverrides;
    if (x.activities) out.activities = x.activities;
    if (x._deleted) out._deleted = x._deleted;
    if (x._deletedLeads) out._deletedLeads = x._deletedLeads;
  } else if (opts.rateOverrides) {
    out.rateOverrides = (await readRateOverrides(admin, owner)).map;
  }
  return out;
}
