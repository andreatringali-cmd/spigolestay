import type { SupabaseClient } from "@supabase/supabase-js";
import { patchEntity } from "./server-entities-write";

// Traccia nell'app (solo server) dei messaggi automatici partiti dal cron: senza, la chat non sa che il messaggio è stato mandato e la coda
// «Invii programmati» lo riproporrebbe (doppioni all'ospite), la scheda prenotazione direbbe «Guida non inviata», la recensione risulterebbe «da richiedere».
//
//  - thread dell'ospite: messaggio in uscita con bid (prenotazione) e rem/rems (tipo di promemoria) → alimenta la cronologia dei solleciti (guest-messages.ts → readReminderLog);
//  - registro «msgsent»: chiave `${modello}-${prenotazione}-${giorno previsto}` → la coda non lo ripropone;
//  - reviewRequestedAt / reviewRequestChannel sulla prenotazione (solo per i modelli di recensione).
// Le scritture usano il lucchetto sul rev (stesso schema del webhook WhatsApp), con più tentativi. Nessuna eccezione verso il chiamante: il registro non deve rompere l'invio.

const DATA_KEY = "spigolestay:data:v1";
const THREADS_KEY = "spigolestay:threads:v1";
const SENT_KEY = "spigolestay:msgsent";
const ATTEMPTS = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arr = <T = unknown>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** Titolare (membership con ruolo owner, attiva) di una struttura condivisa; null se non si trova. */
export async function ownerOfOrg(admin: SupabaseClient, orgId: string): Promise<string | null> {
  try {
    const { data } = await admin.from("memberships").select("user_id, role, active").eq("org_id", orgId);
    const owner = arr<{ user_id?: string; role?: string; active?: boolean }>(data).find((m) => m.role === "owner" && m.active !== false);
    return owner?.user_id ? String(owner.user_id) : null;
  } catch { return null; }
}

/** Blob personale (app_state) di un utente; null se manca. */
export async function loadUserBlob(admin: SupabaseClient, userId: string): Promise<Record<string, string> | null> {
  try {
    const { data } = await admin.from("app_state").select("data").eq("user_id", userId).maybeSingle();
    const blob = (data as { data?: unknown } | null)?.data;
    return blob && typeof blob === "object" ? (blob as Record<string, string>) : null;
  } catch { return null; }
}

type Table = "app_state" | "org_state";
type KeyCol = "user_id" | "org_id";

/** Legge la riga, applica `mutate` al blob e scrive con rev-lock; ritenta in caso di conflitto. `mutate` torna false se non c'è nulla da scrivere. */
async function writeBlob(admin: SupabaseClient, table: Table, keyCol: KeyCol, keyVal: string, mutate: (blob: Record<string, string>) => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(200 * attempt + Math.floor(Math.random() * 120));
    const { data: row } = await admin.from(table).select("data, rev").eq(keyCol, keyVal).maybeSingle();
    if (!row) return false;
    const blob = ((row as { data?: unknown }).data ?? {}) as Record<string, string>;
    const rev = typeof (row as { rev?: number }).rev === "number" ? (row as { rev: number }).rev : null;
    const next = { ...blob };
    if (!mutate(next)) return true; // già a posto
    let w = admin.from(table).update({ data: next, updated_at: new Date().toISOString() }).eq(keyCol, keyVal);
    if (rev !== null) w = w.eq("rev", rev);
    const { data: updated, error } = await w.select("rev");
    if (error) return false;
    if (updated && updated.length > 0) return true;
  }
  return false;
}

export interface AutoSentTrace {
  ownerId: string;        // utente nel cui blob personale vivono chat e registro (per le strutture condivise: il titolare)
  guestId: string;
  bookingId: string;
  text: string;
  via: string;            // «Email», «WhatsApp» o «Email e WhatsApp»
  rems: string[];         // tipi di promemoria coperti dal messaggio (checkin, guide, pay-saldo, review)
  wid?: string;           // id WhatsApp (spunte di consegna)
  msgsentKey?: string;    // chiave del registro «msgsent» (assente = nessuna voce nel registro «Invii programmati», es. promemoria check-in)
  idKey?: string;         // chiave del messaggio nel thread quando manca msgsentKey
  guestName: string;
  tplName: string;
}

/** Scrive nel blob personale del titolare: messaggio nel thread dell'ospite + voce nel registro invii. */
export async function recordAutoSent(admin: SupabaseClient, t: AutoSentTrace): Promise<boolean> {
  try {
    const now = Date.now();
    return await writeBlob(admin, "app_state", "user_id", t.ownerId, (blob) => {
      let threads: Record<string, unknown[]> = {};
      try { threads = JSON.parse(blob[THREADS_KEY] || "{}"); } catch { threads = {}; }
      const id = `auto:${t.msgsentKey ?? t.idKey ?? t.bookingId}:${t.via}`;
      const list = arr<{ id?: string }>(threads[t.guestId]);
      let changed = false;
      if (!list.some((m) => m.id === id)) {
        threads[t.guestId] = [...list, { id, dir: "out", text: t.text, ts: now, via: t.via, bid: t.bookingId, ...(t.rems[0] ? { rem: t.rems[0] } : {}), ...(t.rems.length > 1 ? { rems: t.rems } : {}), ...(t.wid ? { wid: t.wid, st: "sent" } : {}) }];
        blob[THREADS_KEY] = JSON.stringify(threads);
        changed = true;
      }
      let sent: { key?: string }[] = [];
      try { sent = arr(JSON.parse(blob[SENT_KEY] || "[]")); } catch { sent = []; }
      if (t.msgsentKey && !sent.some((s) => s.key === t.msgsentKey)) {
        sent = [{ key: t.msgsentKey, guest: t.guestName, tpl: t.tplName, via: t.via, ts: now } as { key?: string }, ...sent].slice(0, 200);
        blob[SENT_KEY] = JSON.stringify(sent);
        changed = true;
      }
      return changed;
    });
  } catch { return false; }
}

/** Segna sulla prenotazione che la richiesta di recensione è partita (così il percorso dice «Richiesta inviata» e il cron non la rimanda). */
export async function markReviewRequested(admin: SupabaseClient, store: { table: Table; keyCol: KeyCol; keyVal: string }, bookingId: string, channel: "email" | "whatsapp"): Promise<boolean> {
  try {
    // Fase 3, passo 3a (src/lib/server-entities-write.ts): se l'autorita' delle prenotazioni di questo proprietario e' 'table' si aggiorna la riga di public.entities;
    // altrimenti ({ handled:false }, il caso di oggi) prosegue il percorso attuale sul blocco, invariato. (I thread e il registro invii restano nel blocco: chiavi piatte.)
    const tr = await patchEntity(admin, {
      ownerType: store.table === "org_state" ? "o" : "u", ownerId: store.keyVal, kind: "bookings", id: bookingId,
      mutate: (cur) => {
        if (typeof cur.reviewRequestedAt === "number" && cur.reviewRequestedAt > 0) return null; // gia' segnata
        return { ...cur, reviewRequestedAt: Date.now(), reviewRequestChannel: channel };
      },
    });
    if (tr.handled) return tr.ok;
    return await writeBlob(admin, store.table, store.keyCol, store.keyVal, (blob) => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(blob[DATA_KEY] || "{}"); } catch { return false; }
      const bookings = arr<Record<string, unknown>>(data.bookings);
      const i = bookings.findIndex((b) => b && b.id === bookingId);
      if (i < 0 || (typeof bookings[i].reviewRequestedAt === "number" && (bookings[i].reviewRequestedAt as number) > 0)) return false;
      const now = Date.now();
      bookings[i] = { ...bookings[i], reviewRequestedAt: now, reviewRequestChannel: channel, updatedAt: now };
      data.bookings = bookings;
      blob[DATA_KEY] = JSON.stringify(data);
      return true;
    });
  } catch { return false; }
}
