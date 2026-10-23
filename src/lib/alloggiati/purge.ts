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
//
// Fase 3, passo 3b (docs/FASE3-PASSO3B.md): se per quel proprietario l'autorità di `bookings` E `guests` è 'table' (e SERVER_WRITE_ENTITIES=on) le foto non stanno più nel blocco ma
// nelle righe di public.entities: si purgano lì (solo le righe cambiate, con controllo di concorrenza) e un file si cancella dallo Storage solo se NESSUNA riga di prenotazione
// o ospite del proprietario lo cita ancora. Con interruttore spento o autorità 'blob' il percorso sul blocco resta quello di sempre.
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeMedia } from "../media-server";
import { orphanedRefs, privateRefsIn } from "../media-orphans";
import { mutateEntitySet, readRowsByIds, unreferencedRefs, type WriteRow } from "../server-entities-write";

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

/**
 * Purga sulle righe di public.entities. null = non gestita (interruttore spento, autorità 'blob', errore nel leggerla): il chiamante prosegue sul blocco, come sempre.
 * true = almeno una riga riscritta. false = niente da fare oppure errore/conflitto/autorità mista (nel blocco non si scrive mai: non sarebbe più la verità).
 */
async function purgeInTables(admin: SupabaseClient, st: StoreRef, ids: Set<string>): Promise<boolean | null> {
  const ownerType = st.table === "org_state" ? "o" : "u";
  let nBookings = 0;
  let orphans: string[] = [];
  const r = await mutateEntitySet(admin, {
    ownerType, ownerId: st.keyVal, kind: ["bookings", "guests"],
    // Prima le prenotazioni indicate, poi le anagrafiche ospite a cui sono collegate (stesso ordine che poi rivede compute).
    load: async () => {
      const bk = await readRowsByIds(admin, ownerType, st.keyVal, "bookings", [...ids]);
      const gids = bk.map((row) => { let d = row.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = {}; } } return String((d as { guestId?: unknown } | null)?.guestId ?? ""); });
      const gs = await readRowsByIds(admin, ownerType, st.keyVal, "guests", gids);
      nBookings = bk.length;
      return [...bk, ...gs] as WriteRow[];
    },
    compute: (cur) => {
      if (!nBookings) return { action: "noop" };
      // Stessa logica pura del blocco, su un contenuto ridotto (le prenotazioni indicate + i loro ospiti). Gli orfani sono solo CANDIDATI: lo stesso file può essere
      // usato da altre prenotazioni/ospiti che qui non ci sono, quindi si ricontrolla su tutte le righe dopo la scrittura.
      const data: Record<string, unknown> = { bookings: cur.slice(0, nBookings), guests: cur.slice(nBookings) };
      const res = purgeDataPhotos(data, ids);
      if (!res.changed) return { action: "noop" };
      orphans = res.orphans;
      return { action: "changes", changes: cur.map((next, idx) => ({ idx, next })) };
    },
  });
  if (!r.handled) return null;
  if (r.outcome !== "ok") { console.warn("[purge-foto] tabelle: non riuscita", st.table, st.keyVal, r.outcome, r.message ?? ""); return false; }
  if (!r.wrote) return false;
  // Righe già salvate senza le foto: si tolgono dallo Storage (best-effort) solo i file che nessuna riga cita più.
  for (const ref of await unreferencedRefs(admin, ownerType, st.keyVal, orphans)) await removeMedia(admin, ref).catch(() => false);
  return true;
}

// Una scrittura per volta, nel posto dove oggi vive la verità: tabelle (autorità 'table') oppure blocco (tutti gli altri casi).
async function purgeStore(admin: SupabaseClient, st: StoreRef, ids: Set<string>): Promise<boolean> {
  const viaTables = await purgeInTables(admin, st, ids);
  if (viaTables !== null) return viaTables;
  return purgeInStore(admin, st, ids);
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
  for (const st of stores) { try { if (await purgeStore(admin, st, ids)) n++; } catch { /* best-effort per store */ } }
  return n;
}
