// Protezione dati: rimozione delle FOTO del documento (fronte/retro) una volta che
// la schedina è stata inviata alla Questura. Il motivo per cui le conserviamo è
// l'adempimento Alloggiati: concluso quello, le immagini del documento (il dato più
// sensibile) non servono più e vanno cancellate per ridurre l'impronta di dati.
//
// Cosa NON tocca: numero/tipo/scadenza documento (servono allo storico e alla schedina
// già inviata) e la firma del check-in. Cosa rimuove: docPhotoFront/docPhotoBack sulla
// prenotazione, sugli ospiti extra e sull'anagrafica ospite collegata.
//
// Scrive con lucchetto ottimistico sul `rev` (come le altre scritture server) + 1 retry.
// Idempotente: se non c'è nulla da rimuovere non scrive.
import type { SupabaseClient } from "@supabase/supabase-js";

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

async function purgeInStore(admin: SupabaseClient, st: StoreRef, ids: Set<string>): Promise<boolean> {
  const attempt = async (): Promise<"ok" | "conflict" | "skip"> => {
    const { data: row } = await admin.from(st.table).select("data, rev").eq(st.keyCol, st.keyVal).maybeSingle();
    if (!row) return "skip";
    const blob = (((row as { data?: unknown }).data ?? {}) as Record<string, string>) || {};
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(blob[DATA_KEY] || "{}"); } catch { return "skip"; }

    const bookings = arr(data.bookings);
    const guests = arr(data.guests);
    const now = Date.now();
    let changed = false;
    const guestIds = new Set<string>();

    for (const b of bookings) {
      if (!ids.has(String(b.id || ""))) continue;
      let c = stripPhotos(b);
      for (const eg of arr(b.extraGuests)) if (stripPhotos(eg)) c = true;
      if (c) { b.updatedAt = now; changed = true; }
      const gid = String(b.guestId || ""); if (gid) guestIds.add(gid);
    }
    for (const g of guests) {
      if (!guestIds.has(String(g.id || ""))) continue;
      if (stripPhotos(g)) { g.updatedAt = now; changed = true; }
    }
    if (!changed) return "skip";

    const nb = { ...blob, [DATA_KEY]: JSON.stringify(data) };
    const rev = typeof (row as { rev?: number }).rev === "number" ? (row as { rev: number }).rev : null;
    let w = admin.from(st.table).update({ data: nb, updated_at: new Date().toISOString() }).eq(st.keyCol, st.keyVal);
    if (rev !== null) w = w.eq("rev", rev);
    const { data: updated, error } = await w.select("rev");
    if (error) return "conflict";
    return updated && updated.length > 0 ? "ok" : "conflict";
  };
  const r1 = await attempt();
  if (r1 === "ok") return true;
  if (r1 === "skip") return false;
  const r2 = await attempt(); // conflitto: rileggi fresco e riprova una volta
  return r2 === "ok";
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
