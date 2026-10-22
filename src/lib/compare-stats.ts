// Contatori del confronto «blocco contro tabelle» (Fase 3, passo 1): si accumulano in memoria e si mandano al database (tabella entities_compare_stats, migrazione 0021).
// Prima le differenze finivano solo nei log di Vercel (circa un'ora): ora si possono contare su più giorni. Mai un errore verso chi chiama: se l'invio fallisce si perde il conteggio, non la richiesta.
import { createClient } from "@supabase/supabase-js";

export interface CompareRow { label: string; ok: number; diff: number; error: number; detail?: unknown }
export type CompareSender = (rows: CompareRow[]) => Promise<void>;

const pending = new Map<string, CompareRow>();
let lastFlush = 0;
let sender: CompareSender | null = null;
let flushing: Promise<void> | null = null;
const FLUSH_OK_EVERY_MS = 30_000; // i «tutto uguale» si mandano al massimo ogni 30 s; differenze ed errori subito

/** Solo per i test: sostituisce (o ripristina, con null) la destinazione dei contatori e azzera lo stato. */
export function _setCompareSender(fn: CompareSender | null) { sender = fn; pending.clear(); lastFlush = 0; flushing = null; }

async function defaultSender(rows: CompareRow[]): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  await admin.rpc("entities_compare_flush", { p_rows: rows });
}

/** Manda subito i contatori accumulati. Ritorna quando l'invio è finito (i test lo aspettano). */
export function flushCompareStats(): Promise<void> {
  if (flushing) return flushing;
  if (!pending.size) return Promise.resolve();
  const rows = [...pending.values()];
  pending.clear();
  lastFlush = Date.now();
  flushing = (async () => { try { await (sender ?? defaultSender)(rows); } catch { /* il conteggio è facoltativo */ } })().finally(() => { flushing = null; });
  return flushing;
}

/** Un risultato del confronto: result = «ok», «diff» oppure altro (errore o ripiego sul blocco). */
export function recordCompare(label: string, result: string, detail?: unknown): void {
  try {
    const row = pending.get(label) ?? { label, ok: 0, diff: 0, error: 0 };
    if (result === "ok") row.ok++;
    else if (result === "diff") { row.diff++; row.detail = detail; }
    else row.error++;
    pending.set(label, row);
    if (result !== "ok" || Date.now() - lastFlush >= FLUSH_OK_EVERY_MS) void flushCompareStats();
  } catch { /* mai rompere la richiesta */ }
}
