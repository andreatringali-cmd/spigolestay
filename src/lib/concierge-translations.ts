import type { SupabaseClient } from "@supabase/supabase-js";
import { TRANSLATIONS_KEY, parseTranslations, tKey, type TranslationItem } from "@/lib/concierge-i18n";

// Traduzioni della base di conoscenza (de/fr/es) — solo server. Nessuna tabella, nessuna migrazione: vivono nel blob app_state
// del tenant sotto TRANSLATIONS_KEY ("concierge:translations:v1", prefisso diverso da "spigolestay:" / "xenora:" così authsync
// non la sovrascrive mai: stessa scelta e stesso pattern di concierge-unanswered.ts, rev-lock + retry).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any>;

export async function loadTranslations(admin: Admin, tenantId: string): Promise<TranslationItem[]> {
  const { data: row } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
  const blob = (((row as { data?: unknown } | null)?.data ?? {}) as Record<string, string>) || {};
  return parseTranslations(blob[TRANSLATIONS_KEY]);
}

// Legge-modifica-scrive con lucchetto sul rev; riprova (con rilettura fresca) in caso di conflitto. `fn` riceve la mappa corrente
// e restituisce false se non c'è nulla da scrivere.
async function mutate(admin: Admin, tenantId: string, fn: (m: Map<string, TranslationItem>) => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: row } = await admin.from("app_state").select("data, rev").eq("user_id", tenantId).maybeSingle();
    if (!row) return false; // nessuno stato per questo tenant: non creo righe da qui
    const blob = ((row.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number }).rev === "number" ? (row as { rev: number }).rev : null;
    const map = new Map(parseTranslations(blob[TRANSLATIONS_KEY]).map((i) => [tKey(i.id, i.lang), i] as const));
    if (!fn(map)) return true;
    blob[TRANSLATIONS_KEY] = JSON.stringify({ v: 1, items: Array.from(map.values()) });
    let write = admin.from("app_state").update({ data: blob, updated_at: new Date().toISOString() }).eq("user_id", tenantId);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated, error } = await write.select("rev");
    if (error) return false;
    if (updated && updated.length > 0) return true;
    // conflitto di rev (un altro processo ha scritto): rilegge e riprova
  }
  return false;
}

// Inserisce o sostituisce traduzioni.
export async function putTranslations(admin: Admin, tenantId: string, items: TranslationItem[]): Promise<boolean> {
  if (!items.length) return true;
  return mutate(admin, tenantId, (m) => { for (const i of items) m.set(tKey(i.id, i.lang), i); return true; });
}

// Segna come riviste (e riallinea l'impronta all'originale attuale: "ho controllato, vale ancora"). hashes: id -> impronta corrente.
export async function approveTranslations(admin: Admin, tenantId: string, keys: { id: string; lang: string }[], hashes: Map<string, string>): Promise<TranslationItem[]> {
  const out: TranslationItem[] = [];
  const ok = await mutate(admin, tenantId, (m) => {
    out.length = 0;
    for (const k of keys) {
      const cur = m.get(tKey(k.id, k.lang)); const h = hashes.get(k.id);
      if (!cur || !h) continue;
      const next = { ...cur, reviewed: true, srcHash: h };
      m.set(tKey(k.id, k.lang), next); out.push(next);
    }
    return out.length > 0;
  });
  return ok ? out : [];
}

export async function removeTranslation(admin: Admin, tenantId: string, id: string, lang: string): Promise<boolean> {
  return mutate(admin, tenantId, (m) => m.delete(tKey(id, lang)));
}
