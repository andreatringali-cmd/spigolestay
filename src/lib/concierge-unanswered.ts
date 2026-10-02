import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// "Domande senza risposta" del Concierge — solo server. Nessuna tabella nuova: l'elenco vive nel blob app_state del tenant
// (lo stesso che usano le altre route webhook), scritto con lo stesso pattern rev-lock + retry di applyIncoming().
//
// IMPORTANTE (chiave fuori da "spigolestay:" / "xenora:"): authsync.tsx sincronizza col browser solo le chiavi con quei
// prefissi e per le chiavi in comune "vince il locale" in blocco. Una chiave lato server con un prefisso sincronizzato
// verrebbe quindi sovrascritta da una copia locale stantia (stesso bug storico di mergeThreads). Con un prefisso diverso
// il browser non la tocca mai: il blob del server la conserva così com'è a ogni salvataggio, e la UI la legge/aggiorna
// solo tramite /api/concierge/unanswered (che usa gli stessi helper qui sotto).
export const UNANSWERED_KEY = "concierge:unanswered:v1";
export const UNANSWERED_MAX = 200;
export const UNANSWERED_Q_MAX = 200;

// code: gap = domanda non coperta dalla base di conoscenza; nostruct = struttura non determinabile; ai = errore/AI non configurata
export type UnansweredCode = "gap" | "nostruct" | "ai";
export interface UnansweredItem {
  id: string;
  ts: number;          // epoch ms
  q: string;           // testo dell'ospite, troncato
  sid: string;         // struttura di riferimento ("" se non determinabile)
  reason: string;      // motivo leggibile
  code: UnansweredCode;
  topic?: string;      // argomento stimato dall'AI (se disponibile)
  hasBooking?: boolean;
}

export function codeOfReason(reason: string | undefined, structureKnown: boolean): UnansweredCode {
  if (!structureKnown) return "nostruct";
  if (/AI non configurata|errore AI/i.test(reason || "")) return "ai";
  return "gap";
}

export function parseUnanswered(raw: unknown): UnansweredItem[] {
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(p)) return [];
    return p.filter((x) => x && typeof x === "object" && typeof (x as UnansweredItem).id === "string" && typeof (x as UnansweredItem).q === "string") as UnansweredItem[];
  } catch { return []; }
}

// Aggiunge una voce in testa (più recenti prima) con tetto UNANSWERED_MAX.
export function appendUnanswered(list: UnansweredItem[], item: UnansweredItem): UnansweredItem[] {
  return [item, ...list].slice(0, UNANSWERED_MAX);
}

export function makeItem(p: { q: string; sid: string; reason?: string; topic?: string; hasBooking?: boolean }): UnansweredItem {
  const q = p.q.replace(/\s+/g, " ").trim().slice(0, UNANSWERED_Q_MAX);
  const code = codeOfReason(p.reason, !!p.sid);
  return {
    id: randomUUID(), ts: Date.now(), q, sid: p.sid,
    reason: (p.reason || (code === "nostruct" ? "struttura di riferimento non determinabile" : "")).slice(0, 160),
    code, ...(p.topic ? { topic: p.topic.slice(0, 40) } : {}), ...(typeof p.hasBooking === "boolean" ? { hasBooking: p.hasBooking } : {}),
  };
}

// Legge-modifica-scrive il blob con lucchetto sul rev; riprova (con rilettura fresca) in caso di conflitto.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mutate(admin: SupabaseClient<any>, tenantId: string, fn: (list: UnansweredItem[]) => UnansweredItem[] | null): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
    if (!row) return false; // nessuno stato per questo tenant: non creo righe da qui
    const blob = ((row.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number }).rev === "number" ? (row as { rev: number }).rev : null;
    const next = fn(parseUnanswered(blob[UNANSWERED_KEY]));
    if (next === null) return true; // niente da cambiare
    blob[UNANSWERED_KEY] = JSON.stringify(next);
    let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated, error } = await write.select("rev");
    if (error) return false;
    if (updated && updated.length > 0) return true;
    // conflitto di rev (un altro processo ha scritto): rilegge e riprova
  }
  return false;
}

// Registra una domanda a cui il Concierge non ha risposto. Non lancia mai: un fallimento qui non deve toccare il resto.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logUnanswered(admin: SupabaseClient<any>, tenantId: string, p: Parameters<typeof makeItem>[0]): Promise<void> {
  try {
    if (!p.q?.trim()) return;
    const item = makeItem(p);
    await mutate(admin, tenantId, (list) => appendUnanswered(list, item));
  } catch (e) { console.error("[concierge unanswered]", e); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listUnanswered(admin: SupabaseClient<any>, tenantId: string): Promise<UnansweredItem[]> {
  const { data: row } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
  const blob = (((row as { data?: unknown } | null)?.data ?? {}) as Record<string, string>) || {};
  return parseUnanswered(blob[UNANSWERED_KEY]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dismissUnanswered(admin: SupabaseClient<any>, tenantId: string, ids: string[]): Promise<boolean> {
  const drop = new Set(ids);
  if (!drop.size) return true;
  return mutate(admin, tenantId, (list) => (list.some((x) => drop.has(x.id)) ? list.filter((x) => !drop.has(x.id)) : null));
}
