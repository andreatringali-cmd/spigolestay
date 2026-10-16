// Protezione dati: rimozione delle FOTO del documento (fronte/retro) una volta che
// la schedina è stata inviata alla Questura. Il motivo per cui le conserviamo è
// l'adempimento Alloggiati: concluso quello, le immagini del documento (il dato più
// sensibile) non servono più e vanno cancellate per ridurre l'impronta di dati.
//
// Cosa NON tocca: numero/tipo/scadenza documento (servono allo storico e alla schedina
// già inviata) e la firma del check-in. Cosa rimuove: docPhotoFront/docPhotoBack sulla
// prenotazione, sugli ospiti extra e sull'anagrafica ospite collegata.
//
// Le foto possono essere ancora data URI dentro i dati (vecchio formato) oppure riferimenti a file privati su Supabase Storage
// ("media:xenora-private:…", nuovo formato): in entrambi i casi il campo viene azzerato e, per i riferimenti, DOPO la scrittura
// riuscita si cancella anche il file dallo Storage (solo se nessun'altra prenotazione/ospite lo usa ancora: lo stesso file può stare
// sia sulla prenotazione sia sull'anagrafica ospite).
//
// Scrive con lucchetto ottimistico sul `rev` (come le altre scritture server) + 1 retry.
// Idempotente: se non c'è nulla da rimuovere non scrive.
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeMedia } from "../media-server";
import { orphanedRefs, privateRefsIn } from "../media-orphans";

const DATA_KEY = "spigolestay:data:v1";
const arr = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? (x as Record<string, unknown>[]) : []);

interface StoreRef { table: "app_state" | "org_state"; keyCol: "user_id" | "org_id"; keyVal: string }

// Rimuove le due foto da un oggetto (prenotazione/ospite). true se ha rimosso qualcosa.
function stripPhotos(o: Record<string, unknown>): boolean {
  let changed = false;
  if (o.docPhotoFront != null) { delete o.docPhotoFront; changed = true; }
  if (o.docPhotoBack != null) { delete o.docPhotoBack; changed = true; }
  return changed;
}

/**
 * Logica PURA della purga su un contenuto di store (modifica `data` in place): toglie le foto dalle prenotazioni indicate, dai loro
 * ospiti aggiuntivi e dall'anagrafica ospite collegata. Restituisce se ha cambiato qualcosa e i riferimenti a file privati che,
 * dopo la modifica, non sono più usati da nessuna parte (da cancellare dallo Storage una volta salvato).
 */
export function purgeDataPhotos(data: Record<string, unknown>, ids: ReadonlySet<string>, now: number = Date.now()): { changed: boolean; orphans: string[] } {
  const bookings = arr(data.bookings);
  const guests = arr(data.guests);
  let changed = false;
  const guestIds = new Set<string>();
  const targets: Record<string, unknown>[] = [];

  for (const b of bookings) {
    if (!ids.has(String(b.id || ""))) continue;
    targets.push(b);
    for (const eg of arr(b.extraGuests)) targets.push(eg);
    const gid = String(b.guestId || ""); if (gid) guestIds.add(gid);
  }
  for (const g of guests) if (guestIds.has(String(g.id || ""))) targets.push(g);
  const before = privateRefsIn(...targets.map((o) => ({ docPhotoFront: o.docPhotoFront, docPhotoBack: o.docPhotoBack })));

  for (const b of bookings) {
    if (!ids.has(String(b.id || ""))) continue;
    let c = stripPhotos(b);
    for (const eg of arr(b.extraGuests)) if (stripPhotos(eg)) c = true;
    if (c) { b.updatedAt = now; changed = true; }
  }
  for (const g of guests) {
    if (!guestIds.has(String(g.id || ""))) continue;
    if (stripPhotos(g)) { g.updatedAt = now; changed = true; }
  }
  return { changed, orphans: changed ? orphanedRefs(before, data) : [] };
}

async function purgeInStore(admin: SupabaseClient, st: StoreRef, ids: Set<string>): Promise<boolean> {
  let orphans: string[] = [];
  const attempt = async (): Promise<"ok" | "conflict" | "skip"> => {
    const { data: row } = await admin.from(st.table).select("data, rev").eq(st.keyCol, st.keyVal).maybeSingle();
    if (!row) return "skip";
    const blob = (((row as { data?: unknown }).data ?? {}) as Record<string, string>) || {};
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}"); } catch { return "skip"; }

    const res = purgeDataPhotos(data, ids);
    if (!res.changed) return "skip";
    orphans = res.orphans;

    const nb = { ...blob, [DATA_KEY]: JSON.stringify(data) };
    const rev = typeof (row as { rev?: number }).rev === "number" ? (row as { rev: number }).rev : null;
    let w = admin.from(st.table).update({ data: nb, updated_at: new Date().toISOString() }).eq(st.keyCol, st.keyVal);
    if (rev !== null) w = w.eq("rev", rev);
    const { data: updated, error } = await w.select("rev");
    if (error) return "conflict";
    return updated && updated.length > 0 ? "ok" : "conflict";
  };
  let r = await attempt();
  if (r === "conflict") r = await attempt(); // conflitto: rileggi fresco e riprova una volta
  if (r !== "ok") return false;
  // Dati già salvati senza le foto: ora si possono togliere i file dallo Storage (best-effort).
  for (const ref of orphans) await removeMedia(admin, ref).catch(() => false);
  return true;
}

// Purga le foto documento per le prenotazioni indicate, nello stato personale del tenant
// e negli stati delle organizzazioni di cui è membro (dove possono vivere le strutture in
// società). Best-effort: non solleva, ritorna il numero di stati modificati.
export async function purgeDocPhotos(admin: SupabaseClient, tenantId: string, bookingIds: string[]): Promise<number> {
  const ids = new Set(bookingIds.filter(Boolean));
  if (ids.size === 0) return 0;
  const stores: StoreRef[] = [{ table: "app_state", keyCol: "user_id", keyVal: tenantId }];
  const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", tenantId);
  for (const m of arr(ms)) { const oid = String(m.org_id || ""); if (oid) stores.push({ table: "org_state", keyCol: "org_id", keyVal: oid }); }

  let n = 0;
  for (const st of stores) { try { if (await purgeInStore(admin, st, ids)) n++; } catch { /* best-effort per store */ } }
  return n;
}
