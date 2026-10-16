// Migrazione dei DATI ESISTENTI: le foto salvate come data URI dentro i blob di stato (app_state / org_state) passano su Supabase
// Storage e nei dati restano solo i riferimenti "media:<bucket>:<percorso>". Solo SERVER (usa il client service-role, iniettato).
//
// Garanzie (nulla si perde):
//   1. BACKUP della riga ORIGINALE, una volta sola per riga, in _xn_backup_20261007 (kind media_migrate_20261016) PRIMA di toccarla;
//      se il backup non riesce la riga non viene toccata.
//   2. Ogni file caricato viene RISCARICATO e confrontato byte per byte con l'originale: se non coincide la data URI resta dov'è.
//   3. La riga si scrive con lucchetto ottimistico su rev (.eq("rev", rev)). Se nel frattempo è cambiata si rilegge e si riapplicano
//      solo le sostituzioni il cui valore corrente è ancora ESATTAMENTE la stessa data URI (fino a 3 tentativi).
//   4. Si cambiano solo le stringhe-foto (e updatedAt delle sole entità toccate); il resto del blob resta com'è, byte per byte.
//   5. Nessun file e nessun dato viene mai cancellato (un caricamento non verificato resta come file orfano, innocuo).
//   6. A blocchi (maxImages / maxMs) e idempotente: si può interrompere e rilanciare quando si vuole.
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkUpload, parseDataUri, sniffMediaType, type MediaScope } from "./media";
import { downloadMedia, putMedia } from "./media-server";
import {
  BACKUP_TABLE, MIGRATE_BACKUP_KIND, applyRefs, bucketForVisibility, dedupKey, planRow, type PlanItem,
} from "./media-migrate-plan";

export type RowTable = "app_state" | "org_state";
export interface RowRef { table: RowTable; id: string }
export const rowLabel = (r: RowRef): string => `${r.table}:${r.id}`;
const idColumn = (t: RowTable): string => (t === "org_state" ? "org_id" : "user_id");
/** Righe org_state → scope "o" con l'org_id; righe app_state → scope "u" con lo user_id. */
export const rowScope = (r: RowRef): { scope: MediaScope; id: string } => ({ scope: r.table === "org_state" ? "o" : "u", id: r.id.toLowerCase() });

export interface MigrateOptions {
  /** Solo conteggi: nessun upload, nessuna scrittura, nessun backup. */
  dryRun?: boolean;
  /** Massimo di file (immagini uniche) caricati in questa chiamata. Default 10. */
  maxImages?: number;
  /** Tempo massimo della chiamata, in ms. Default 40000. */
  maxMs?: number;
  /** Solo per i test: orologio, caricamento e lettura dei file. */
  now?: () => number;
  deps?: {
    put?: (admin: SupabaseClient, o: { bucket: ReturnType<typeof bucketForVisibility>; scope: MediaScope; id: string; mime: string; bytes: Uint8Array }) => Promise<string>;
    download?: (admin: SupabaseClient, ref: string) => Promise<{ mime: string; bytes: Uint8Array } | null>;
  };
}

export interface MigrateError { row: string; path: string; message: string }
export interface RowSummary {
  row: string;
  /** Foto migrabili ancora inline (occorrenze) e peso in caratteri, per classe. */
  publicCount: number; publicChars: number;
  privateCount: number; privateChars: number;
}
export interface MigrateResult {
  ok: boolean;
  dryRun: boolean;
  /** Occorrenze di data URI sostituite con un riferimento in questa chiamata. */
  processed: number;
  /** File unici caricati e verificati in questa chiamata. */
  uploaded: number;
  remainingImages: number;
  remainingBytes: number;
  rowsTouched: number;
  errors: MigrateError[];
  /** Data URI che NON si possono migrare (formato non ammesso, troppo grandi…): restano inline e non bloccano `done`. */
  skipped: MigrateError[];
  warnings: string[];
  rows: RowSummary[];
  /** La scansione si è fermata per tempo: i conteggi sono parziali. */
  partialScan: boolean;
  done: boolean;
  error?: string;
}

const DEFAULT_MAX_IMAGES = 10;
const DEFAULT_MAX_MS = 40_000;
const MAX_ATTEMPTS = 3;

const msg = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "errore sconosciuto");
const pathStr = (it: PlanItem): string => `${it.key}:${it.path.join(".")}`;

type Validation = { ok: true; mime: string; bytes: Uint8Array } | { ok: false; error: string };

/** Data URI → byte validati come un upload normale (formato ammesso per la classe, dimensione, tipo reale dei byte). */
export function validateItem(uri: string, visibility: PlanItem["visibility"]): Validation {
  const parsed = parseDataUri(uri);
  if (!parsed) return { ok: false, error: "Data URI non valida (non base64)." };
  // Il tipo dichiarato può essere impreciso (es. image/jpg): conta il tipo REALE dei byte, che checkUpload verifica comunque.
  const real = sniffMediaType(parsed.bytes);
  const chk = checkUpload({ visibility, declaredType: real ?? parsed.mime, bytes: parsed.bytes });
  if (!chk.ok) return { ok: false, error: chk.error };
  return { ok: true, mime: chk.mime, bytes: parsed.bytes };
}

interface RowData { data: Record<string, string>; rev: number | null }

async function readRow(admin: SupabaseClient, r: RowRef): Promise<RowData | null> {
  const { data, error } = await admin.from(r.table).select("data, rev").eq(idColumn(r.table), r.id).maybeSingle();
  if (error) throw new Error(error.message || "lettura riga non riuscita");
  if (!data) return null;
  const row = data as { data?: Record<string, string> | null; rev?: number | null };
  return { data: row.data && typeof row.data === "object" ? row.data : {}, rev: typeof row.rev === "number" ? row.rev : null };
}

async function listRows(admin: SupabaseClient): Promise<RowRef[]> {
  const out: RowRef[] = [];
  const u = await admin.from("app_state").select("user_id");
  if (u.error) throw new Error(u.error.message || "elenco app_state non riuscito");
  for (const r of (u.data ?? []) as { user_id?: string }[]) if (r.user_id) out.push({ table: "app_state", id: r.user_id });
  const o = await admin.from("org_state").select("org_id");
  if (o.error) throw new Error(o.error.message || "elenco org_state non riuscito");
  for (const r of (o.data ?? []) as { org_id?: string }[]) if (r.org_id) out.push({ table: "org_state", id: r.org_id });
  return out;
}

interface ScanRow extends RowSummary {
  ref: RowRef;
  /** Voci migrabili valide (occorrenze) e non migrabili (permanenti). */
  validCount: number; validChars: number;
  skipped: MigrateError[];
}

/** Classifica le voci di una riga: valide (si possono migrare) o da saltare per sempre. Decodifica ogni data URI unica una volta. */
function scanData(ref: RowRef, data: Record<string, string>): ScanRow {
  const label = rowLabel(ref);
  const sum: ScanRow = { ref, row: label, publicCount: 0, publicChars: 0, privateCount: 0, privateChars: 0, validCount: 0, validChars: 0, skipped: [] };
  const cache = new Map<string, string | null>(); // dedupKey → errore (null = valida)
  for (const it of planRow(data)) {
    const k = dedupKey(it.visibility, it.uri);
    if (!cache.has(k)) { const v = validateItem(it.uri, it.visibility); cache.set(k, v.ok ? null : v.error); }
    const err = cache.get(k);
    if (err) { sum.skipped.push({ row: label, path: pathStr(it), message: err }); continue; }
    sum.validCount++; sum.validChars += it.uri.length;
    if (it.visibility === "public") { sum.publicCount++; sum.publicChars += it.uri.length; } else { sum.privateCount++; sum.privateChars += it.uri.length; }
  }
  return sum;
}

/** Backup della riga ORIGINALE (una volta sola). Lancia se non riesce: in quel caso la riga non va toccata. */
async function ensureBackup(admin: SupabaseClient, ref: RowRef, original: Record<string, string>, nowMs: number): Promise<void> {
  const key = rowLabel(ref);
  const ex = await admin.from(BACKUP_TABLE).select("key").eq("kind", MIGRATE_BACKUP_KIND).eq("key", key);
  if (ex.error) throw new Error(`controllo backup non riuscito: ${ex.error.message}`);
  if (Array.isArray(ex.data) && ex.data.length > 0) return;
  const ins = await admin.from(BACKUP_TABLE).insert({ backed_up_at: new Date(nowMs).toISOString(), kind: MIGRATE_BACKUP_KIND, key, data: original });
  if (ins.error) throw new Error(`backup non riuscito: ${ins.error.message}`);
}

interface RowOutcome { written: boolean; replaced: number; uploaded: number; remaining: { count: number; chars: number } | null; errors: MigrateError[]; warnings: string[] }

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

/** Elabora UNA riga: carica+verifica fino a `budget.images` file, poi scrive con lucchetto su rev (3 tentativi). */
async function migrateRow(admin: SupabaseClient, ref: RowRef, budget: { images: number }, deadline: number, o: Required<Pick<MigrateOptions, "now">> & MigrateOptions): Promise<RowOutcome> {
  const label = rowLabel(ref);
  const out: RowOutcome = { written: false, replaced: 0, uploaded: 0, remaining: null, errors: [], warnings: [] };
  const put = o.deps?.put ?? putMedia;
  const download = o.deps?.download ?? downloadMedia;
  const target = rowScope(ref);
  const refs = new Map<string, string>(); // dedupKey → riferimento già caricato E verificato (riusato nei tentativi successivi)
  const failed = new Set<string>();       // dedupKey che hanno fallito (upload/verifica) in questa chiamata: non si riprovano nello stesso giro, ma restano da migrare
  const invalid = new Set<string>();      // dedupKey NON migrabili per sempre (formato, dimensione): restano inline e non contano come rimanenti
  let backedUp = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let row: RowData | null;
    try { row = await readRow(admin, ref); } catch (e) { out.errors.push({ row: label, path: "", message: msg(e) }); return out; }
    if (!row) return out;

    const items = planRow(row.data);
    if (!items.length) { out.remaining = { count: 0, chars: 0 }; return out; }

    // 1) backup della riga ORIGINALE prima di qualunque modifica
    if (!backedUp) {
      try { await ensureBackup(admin, ref, row.data, o.now()); backedUp = true; }
      catch (e) { out.errors.push({ row: label, path: "", message: msg(e) }); return out; }
    }

    // 2) carica e verifica le immagini uniche (le più pesanti per prime), nel limite di budget e di tempo
    const seen = new Set<string>();
    const todo: { k: string; it: PlanItem }[] = [];
    for (const it of items) { const k = dedupKey(it.visibility, it.uri); if (!seen.has(k)) { seen.add(k); todo.push({ k, it }); } }
    todo.sort((a, b) => b.it.uri.length - a.it.uri.length);
    for (const { k, it } of todo) {
      if (refs.has(k) || failed.has(k)) continue;
      const v = validateItem(it.uri, it.visibility);
      if (!v.ok) { invalid.add(k); continue; }
      if (budget.images <= 0 || o.now() >= deadline) continue; // fuori budget: resta inline, ci pensa la prossima chiamata
      budget.images--;
      try {
        const ref0 = await put(admin, { bucket: bucketForVisibility(it.visibility), scope: target.scope, id: target.id, mime: v.mime, bytes: v.bytes });
        const back = await download(admin, ref0);
        if (!back) throw new Error("verifica fallita: file non rileggibile dopo il caricamento");
        if (back.bytes.length !== v.bytes.length) throw new Error(`verifica fallita: ${back.bytes.length} byte letti, ${v.bytes.length} attesi`);
        if (!sameBytes(back.bytes, v.bytes)) throw new Error("verifica fallita: il contenuto riletto non coincide");
        refs.set(k, ref0);
        out.uploaded++;
      } catch (e) { failed.add(k); out.errors.push({ row: label, path: pathStr(it), message: msg(e) }); }
    }

    // 3) sostituzione nel blob (solo dove il valore corrente è esattamente la data URI caricata) e scrittura con lucchetto
    const applied = applyRefs(row.data, refs, o.now());
    if (applied.replaced === 0) {
      const left = planRow(row.data).filter((x) => !invalid.has(dedupKey(x.visibility, x.uri)));
      out.remaining = { count: left.length, chars: left.reduce((n, x) => n + x.uri.length, 0) };
      return out;
    }
    let q = admin.from(ref.table).update({ data: applied.data, updated_at: new Date(o.now()).toISOString() }).eq(idColumn(ref.table), ref.id);
    if (row.rev !== null) q = q.eq("rev", row.rev);
    const { data: upd, error: wErr } = await q.select("rev");
    if (wErr) { out.errors.push({ row: label, path: "", message: `scrittura non riuscita: ${wErr.message}` }); return out; }
    const updated = (upd as { rev?: number }[] | null) ?? [];
    if (updated.length === 0) continue; // il rev è cambiato (un client ha salvato): si rilegge e si riapplica solo ciò che è ancora valido
    out.written = true;
    out.replaced = applied.replaced;
    const newRev = updated[0]?.rev;
    if (row.rev !== null && !(typeof newRev === "number" && newRev > row.rev)) out.warnings.push(`${label}: rev non incrementato dal database (letto ${row.rev}, risposta ${String(newRev)}): i client potrebbero non accorgersi della modifica`);
    const left = planRow(applied.data).filter((x) => { const k = dedupKey(x.visibility, x.uri); return !invalid.has(k) && (seen.has(k) || validateItem(x.uri, x.visibility).ok); });
    out.remaining = { count: left.length, chars: left.reduce((n, x) => n + x.uri.length, 0) };
    return out;
  }
  out.errors.push({ row: label, path: "", message: `conflitto di versione ripetuto (${MAX_ATTEMPTS} tentativi): la riga è cambiata mentre la elaboravo, riprovo alla prossima chiamata` });
  return out;
}

/**
 * Esegue UN blocco di migrazione su tutte le righe di app_state e org_state (le più pesanti per prime).
 * In dryRun legge soltanto. Non lancia mai: gli errori finiscono in `errors` / `error`.
 */
export async function migrateMedia(admin: SupabaseClient, opts: MigrateOptions = {}): Promise<MigrateResult> {
  const now = opts.now ?? Date.now;
  const start = now();
  const maxMs = Math.max(1000, opts.maxMs ?? DEFAULT_MAX_MS);
  const deadline = start + maxMs;
  const scanDeadline = start + Math.floor(maxMs * 0.6);
  const dryRun = !!opts.dryRun;
  const budget = { images: Math.max(0, Math.floor(opts.maxImages ?? DEFAULT_MAX_IMAGES)) };
  const res: MigrateResult = { ok: true, dryRun, processed: 0, uploaded: 0, remainingImages: 0, remainingBytes: 0, rowsTouched: 0, errors: [], skipped: [], warnings: [], rows: [], partialScan: false, done: false };

  // 1) scansione leggera: per ogni riga quante foto migrabili ha. Si legge una riga alla volta e si butta subito.
  let refs: RowRef[];
  try { refs = await listRows(admin); } catch (e) { return { ...res, ok: false, error: msg(e), done: false }; }
  const scans: ScanRow[] = [];
  for (const r of refs) {
    if (now() >= scanDeadline) { res.partialScan = true; break; }
    try {
      const row = await readRow(admin, r);
      if (!row) continue;
      const s = scanData(r, row.data);
      if (s.validCount > 0 || s.skipped.length > 0) scans.push(s);
    } catch (e) { res.errors.push({ row: rowLabel(r), path: "", message: msg(e) }); }
  }
  scans.sort((a, b) => b.validChars - a.validChars);
  for (const s of scans) res.skipped.push(...s.skipped);
  res.rows = scans.filter((s) => s.validCount > 0).map(({ row, publicCount, publicChars, privateCount, privateChars }) => ({ row, publicCount, publicChars, privateCount, privateChars }));

  const remaining = new Map<string, { count: number; chars: number }>();
  for (const s of scans) if (s.validCount > 0) remaining.set(s.row, { count: s.validCount, chars: s.validChars });

  // 2) elaborazione a blocchi (non in dryRun)
  if (!dryRun) {
    for (const s of scans) {
      if (s.validCount === 0) continue;
      if (budget.images <= 0 || now() >= deadline) break;
      const oc = await migrateRow(admin, s.ref, budget, deadline, { ...opts, now });
      res.errors.push(...oc.errors);
      res.warnings.push(...oc.warnings);
      res.uploaded += oc.uploaded;
      if (oc.written) { res.rowsTouched++; res.processed += oc.replaced; }
      if (oc.remaining) { if (oc.remaining.count > 0) remaining.set(s.row, oc.remaining); else remaining.delete(s.row); }
    }
  }

  for (const v of remaining.values()) { res.remainingImages += v.count; res.remainingBytes += v.chars; }
  res.ok = res.errors.length === 0;
  res.done = res.remainingImages === 0 && !res.partialScan && res.errors.length === 0;
  return res;
}
