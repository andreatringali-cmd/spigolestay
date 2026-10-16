// Migrazione delle foto già salvate come data URI dentro i dati (guests, bookings, units, sito…) verso Supabase Storage.
//
// MODULO PURO (nessun I/O, nessun import server): usabile dal motore (media-migrate.ts), dal browser (authsync.tsx) e dai test.
// Contiene:
//   - la CLASSIFICAZIONE per percorso (cosa migrare, e se pubblico o privato);
//   - la lettura di una riga di stato (mappa chiave → stringa JSON) in "voci da migrare";
//   - l'applicazione delle sostituzioni (copia, mai mutando l'input) con il timbro updatedAt sulle entità toccate;
//   - la protezione lato client contro le copie vecchie (adoptMigratedMedia), usata dalla fusione di authsync.
import { isInlineMedia, isMediaRef, PRIVATE_BUCKET, PUBLIC_BUCKET, type MediaVisibility } from "./media";
import { collectInlineImages, replaceInlineImages, type WalkPath } from "./media-walk";

/** Chiave del blob principale (guests, bookings, units, structures, roomTypes…). */
export const MAIN_KEY = "spigolestay:data:v1";
/** Tabella dei backup già esistente e tipo usato da questa migrazione. */
export const BACKUP_TABLE = "_xn_backup_20261007";
export const MIGRATE_BACKUP_KIND = "media_migrate_20261016";

/** Chiavi piatte che contengono foto PUBBLICHE: sito (anche per struttura) e immagini ausiliarie. */
export function isMediaFlatKey(key: string): boolean {
  return key === "spigolestay:sito" || key.startsWith("spigolestay:sito:") || key === "spigolestay:images";
}
/** Chiave da esaminare? (blob principale o chiave piatta con foto pubbliche.) Tutte le altre — es. guide, loghi — non si toccano. */
export const isMigratableKey = (key: string): boolean => key === MAIN_KEY || isMediaFlatKey(key);

/** Prefiltro economico su una stringa JSON: può contenere data URI di immagini/PDF? (Evita di fare JSON.parse di chiavi senza foto.) */
export const mayHaveInlineMedia = (raw: unknown): raw is string => typeof raw === "string" && raw.length > 24 && /data:(image|application)/i.test(raw);

/**
 * Dove va (o se va) la data URI trovata in `path` dentro la chiave `key`:
 *   - units[i].photos[j]                              → pubblico
 *   - chiavi del sito / spigolestay:images            → pubblico
 *   - qualunque data URI dentro guests[…] / bookings[…] → privato (documenti, firme, co-ospiti)
 *   - tutto il resto (structures[].logo, roomTypes, guide, foto utente…) → null: NON si migra (serve inline per PDF, email, guide).
 */
export function classifyPath(key: string, path: WalkPath): MediaVisibility | null {
  if (isMediaFlatKey(key)) return "public";
  if (key !== MAIN_KEY) return null;
  const root = path[0];
  if (root === "units") return path.length === 4 && typeof path[1] === "number" && path[2] === "photos" && typeof path[3] === "number" ? "public" : null;
  if (root === "guests" || root === "bookings") return "private";
  return null;
}

export interface PlanItem { key: string; path: WalkPath; uri: string; visibility: MediaVisibility }

const parseJson = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return undefined; } };

/** Tutte le data URI migrabili (secondo classifyPath) in una riga di stato. Chiavi non valide o senza foto vengono saltate. */
export function planRow(data: Record<string, string> | null | undefined): PlanItem[] {
  const out: PlanItem[] = [];
  if (!data || typeof data !== "object") return out;
  for (const key of Object.keys(data)) {
    if (!isMigratableKey(key)) continue;
    const raw = data[key];
    if (!mayHaveInlineMedia(raw)) continue;
    const parsed = parseJson(raw);
    if (parsed === undefined) continue;
    for (const { path, uri } of collectInlineImages(parsed)) {
      const visibility = classifyPath(key, path);
      if (visibility) out.push({ key, path, uri, visibility });
    }
  }
  return out;
}

/** Chiave di deduplicazione: la stessa immagine nello stesso bucket si carica una volta sola. */
export const dedupKey = (visibility: MediaVisibility, uri: string): string => `${visibility}|${uri}`;
export const bucketForVisibility = (v: MediaVisibility) => (v === "public" ? PUBLIC_BUCKET : PRIVATE_BUCKET);

const ENTITY_COLLECTIONS_TO_STAMP = new Set(["guests", "bookings", "units"]);

export interface ApplyResult {
  /** Nuova mappa chiave → stringa JSON (le chiavi non toccate restano la STESSA stringa). */
  data: Record<string, string>;
  /** Data URI sostituite (occorrenze). */
  replaced: number;
  /** Percorsi (stringa) delle occorrenze sostituite, per i report. */
  paths: string[];
  /** Entità (collezione + posizione) a cui è stato messo il nuovo updatedAt. */
  stamped: number;
}

/**
 * Applica le sostituzioni: ogni data URI migrabile per cui `refs` ha un riferimento (chiave dedupKey) diventa quel riferimento.
 * Si sostituisce SOLO dove il valore corrente è esattamente la data URI nota: le stringhe diverse non si toccano mai.
 * Sulle entità modificate (guests/bookings/units) mette updatedAt = max(adesso, vecchio + 1), così nella fusione dei client
 * (merge3, last-write-wins per entità) la versione del server batte sempre la copia vecchia.
 */
export function applyRefs(data: Record<string, string>, refs: ReadonlyMap<string, string>, now: number): ApplyResult {
  const next: Record<string, string> = { ...data };
  let replaced = 0, stamped = 0;
  const paths: string[] = [];
  for (const key of Object.keys(data)) {
    if (!isMigratableKey(key)) continue;
    const raw = data[key];
    if (!mayHaveInlineMedia(raw)) continue;
    const parsed = parseJson(raw);
    if (parsed === undefined) continue;
    const touched = new Set<string>(); // "collezione|posizione"
    const out = replaceInlineImages(parsed, (uri, path) => {
      const vis = classifyPath(key, path);
      if (!vis) return null;
      const ref = refs.get(dedupKey(vis, uri));
      if (!ref) return null;
      replaced++; paths.push(`${key}:${path.join(".")}`);
      if (key === MAIN_KEY && typeof path[0] === "string" && ENTITY_COLLECTIONS_TO_STAMP.has(path[0]) && typeof path[1] === "number") touched.add(`${path[0]}|${path[1]}`);
      return ref;
    });
    if (out === parsed) continue;
    if (key === MAIN_KEY && out && typeof out === "object") {
      const o = out as Record<string, unknown>;
      for (const t of touched) {
        const [coll, idxS] = t.split("|");
        const list = o[coll];
        const idx = Number(idxS);
        if (!Array.isArray(list)) continue;
        const ent = list[idx];
        if (!ent || typeof ent !== "object") continue;
        const old = (ent as { updatedAt?: unknown }).updatedAt;
        const prev = typeof old === "number" && isFinite(old) ? old : 0;
        // `list` e `ent` sono copie create dalla sostituzione (rami cambiati): si possono modificare senza toccare l'input.
        (ent as Record<string, unknown>).updatedAt = Math.max(now, prev + 1);
        stamped++;
      }
    }
    next[key] = JSON.stringify(out);
  }
  return { data: next, replaced, paths, stamped };
}

// ---- Protezione lato client (fusione di authsync) -------------------------------------------------------------------------
// Nelle chiavi piatte (sito, immagini) la fusione dei client è "vince il locale" in blocco: un browser con una copia vecchia (data URI)
// riscriverebbe le foto sul server dopo la migrazione. adoptMigratedMedia lo evita SENZA perdere modifiche: se la copia locale e quella
// del server sono identiche in tutto tranne che nelle foto — dove il locale ha una data URI e il server il riferimento (o la stessa data
// URI) — si adotta la versione del server. Se invece il locale ha altre modifiche, resta il locale (la migrazione le rifarà alla prossima
// esecuzione): mai si butta via una modifica dell'utente.
function sameModuloMigration(l: unknown, s: unknown): boolean {
  if (typeof l === "string") {
    if (isInlineMedia(l)) return typeof s === "string" && (l === s || isMediaRef(s));
    return l === s;
  }
  if (l === null || typeof l !== "object") return Object.is(l, s);
  if (s === null || typeof s !== "object") return false;
  if (Array.isArray(l)) {
    if (!Array.isArray(s) || l.length !== s.length) return false;
    for (let i = 0; i < l.length; i++) if (!sameModuloMigration(l[i], s[i])) return false;
    return true;
  }
  if (Array.isArray(s)) return false;
  const lk = Object.keys(l as object), sk = Object.keys(s as object);
  if (lk.length !== sk.length) return false;
  for (const k of lk) {
    if (!Object.prototype.hasOwnProperty.call(s, k)) return false;
    if (!sameModuloMigration((l as Record<string, unknown>)[k], (s as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** Valore del server da adottare al posto di quello locale (stringhe JSON), oppure null se il locale resta com'è. */
export function adoptMigratedMedia(localRaw: string | undefined, serverRaw: string | undefined): string | null {
  if (typeof localRaw !== "string" || typeof serverRaw !== "string" || localRaw === serverRaw) return null;
  if (!mayHaveInlineMedia(localRaw)) return null; // il locale non ha foto vecchie: niente da proteggere
  const l = parseJson(localRaw), s = parseJson(serverRaw);
  if (l === undefined || s === undefined) return null;
  return sameModuloMigration(l, s) ? serverRaw : null;
}
