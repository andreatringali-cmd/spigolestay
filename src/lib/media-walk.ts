// Percorre oggetti/array/stringhe JSON cercando immagini incorporate (data URI) o riferimenti media.
// Serve alla migrazione (data URI → Storage) e alla pubblicazione del sito (riferimento → URL pubblico).
// PURO: nessun I/O. Non modifica mai l'input: restituisce copie solo dei rami cambiati (gli altri restano lo stesso oggetto).
import { isInlineMedia, isMediaRef, publicUrlOf } from "./media";

export type WalkPath = (string | number)[];
export interface InlineImage { path: WalkPath; uri: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Tutte le data URI di immagini (data:image/…) o PDF (data:application/pdf…) presenti nel valore, con il loro percorso. */
export function collectInlineImages(value: unknown): InlineImage[] {
  const out: InlineImage[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, path: WalkPath) => {
    if (typeof v === "string") { if (isInlineMedia(v)) out.push({ path, uri: v }); return; }
    if (!isObj(v) || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else for (const k of Object.keys(v)) walk(v[k], [...path, k]);
  };
  walk(value, []);
  return out;
}

/** Quanti byte (caratteri) di data URI contiene il valore: per i report della migrazione. */
export function inlineImageStats(value: unknown): { count: number; chars: number } {
  const all = collectInlineImages(value);
  return { count: all.length, chars: all.reduce((n, x) => n + x.uri.length, 0) };
}

/**
 * Copia del valore con ogni stringa che soddisfa `match` sostituita da `fn(stringa, percorso)`.
 * `fn` che restituisce null/undefined lascia la stringa com'è. I rami non toccati restano lo STESSO oggetto (confronto con ===).
 */
function mapStrings(value: unknown, match: (s: string) => boolean, fn: (s: string, path: WalkPath) => string | null | undefined): unknown {
  const walk = (v: unknown, path: WalkPath): unknown => {
    if (typeof v === "string") { if (!match(v)) return v; const r = fn(v, path); return typeof r === "string" ? r : v; }
    if (!isObj(v)) return v;
    if (Array.isArray(v)) {
      let changed: unknown[] | null = null;
      v.forEach((x, i) => { const n = walk(x, [...path, i]); if (n !== x) { if (!changed) changed = v.slice(); changed[i] = n; } });
      return changed ?? v;
    }
    let changed: Record<string, unknown> | null = null;
    for (const k of Object.keys(v)) { const n = walk(v[k], [...path, k]); if (n !== v[k]) { if (!changed) changed = { ...v }; changed[k] = n; } }
    return changed ?? v;
  };
  return walk(value, []);
}

/** Sostituisce ogni data URI (immagine/PDF) con `fn(uri, percorso)`. null/undefined = lascia com'è. Sincrona. */
export function replaceInlineImages<T>(value: T, fn: (uri: string, path: WalkPath) => string | null | undefined): T {
  return mapStrings(value, isInlineMedia, fn) as T;
}

/**
 * Versione asincrona (per caricare su Storage): la stessa data URI presente più volte viene caricata UNA sola volta.
 * Le sostituzioni avvengono in sequenza (un upload alla volta); se `fn` lancia un errore, quella stringa resta com'è e l'errore
 * viene riportato in `errors` (la migrazione è incrementale: riprova alla prossima esecuzione).
 */
export async function replaceInlineImagesAsync<T>(
  value: T,
  fn: (uri: string, path: WalkPath) => Promise<string | null | undefined>,
): Promise<{ value: T; replaced: number; errors: { path: WalkPath; message: string }[] }> {
  const found = collectInlineImages(value);
  const cache = new Map<string, string | null>();
  const errors: { path: WalkPath; message: string }[] = [];
  let replaced = 0;
  for (const { uri, path } of found) {
    if (cache.has(uri)) continue;
    try { const r = await fn(uri, path); cache.set(uri, typeof r === "string" ? r : null); }
    catch (e) { cache.set(uri, null); errors.push({ path, message: e instanceof Error ? e.message : String(e) }); }
  }
  const next = mapStrings(value, isInlineMedia, (s) => { const r = cache.get(s); if (r) replaced++; return r; });
  return { value: next as T, replaced, errors };
}

/** Come replaceInlineImages ma su una stringa JSON (es. le chiavi "spigolestay:sito*"). Se non cambia nulla restituisce la STESSA stringa. JSON non valido → invariata. */
export function replaceInlineImagesInJson(json: string, fn: (uri: string, path: WalkPath) => string | null | undefined): string {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return json; }
  const next = replaceInlineImages(data, fn);
  return next === data ? json : JSON.stringify(next);
}

/** Sostituisce i riferimenti media PUBBLICI con il loro URL pubblico assoluto (per snapshot pubblici e servizi esterni). I privati restano com'erano. */
export function publicizeMediaRefs<T>(value: T, supabaseUrl?: string | null): T {
  return mapStrings(value, isMediaRef, (s) => publicUrlOf(s, supabaseUrl)) as T;
}

/** Versione per stringhe JSON di publicizeMediaRefs. Stessa stringa se non cambia nulla. */
export function publicizeMediaRefsInJson(json: string, supabaseUrl?: string | null): string {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return json; }
  const next = publicizeMediaRefs(data, supabaseUrl);
  return next === data ? json : JSON.stringify(next);
}
