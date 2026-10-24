import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBlockData, readEntityRows, type EntityKind, type EntityOwner, type Json } from "./server-entities";
import { readTableKinds } from "./server-entities-write";

// Fase 3, passo 3a+: ricostruzione dello «store» (l'oggetto `data` del blocco) dalle tabelle public.entities, SOLO per i tipi di entita' la cui autorita' e' 'table'.
//
// Quando per un proprietario (owner_type 'u' = app_state, 'o' = org_state) e un tipo (bookings, structures, guests, ...) la tabella public.entity_authority dice 'table',
// il blocco spigolestay:data:v1 NON contiene piu' quella collezione (e' vuota): chi la cerca scansionando il blocco non trova nulla. Qui si legge la collezione dalle tabelle
// e la si rimette al posto di quella (vuota) del blocco. Le collezioni con autorita' 'blob' restano quelle del blocco, intatte: uno store «misto» e' normale.
//
// Regola d'oro, la stessa degli scrittori (server-entities-write.ts): si guarda l'autorita' SOLO con SERVER_WRITE_ENTITIES=on. In ogni altro caso (interruttore spento,
// tabella entity_authority assente, nessuna riga, valore 'blob', QUALUNQUE errore nel leggere l'autorita') l'elenco dei tipi 'table' e' vuoto, nessuna lettura delle tabelle
// e l'oggetto restituito e' esattamente quello ricevuto: comportamento di oggi. Con l'interruttore spento non c'e' nemmeno una chiamata al database.
// Indipendente da SERVER_READ_ENTITIES: se la verita' e' la tabella, leggere il blocco darebbe dati sbagliati in qualunque modalita' di lettura.
// Istruzioni: docs/FASE3-STORE-DA-TABELLE.md.

/** I tipi che i lettori usano per ricomporre uno store (le collezioni «forti» del blocco). */
export const STORE_KINDS: EntityKind[] = ["structures", "roomTypes", "units", "bookings", "guests"];

/** Quali tra `kinds` sono 'table' per questo proprietario. [] se l'interruttore e' spento o l'autorita' non si legge. Non lancia mai. */
export async function tableKindsOf(admin: SupabaseClient, owner: EntityOwner, kinds: readonly EntityKind[] = STORE_KINDS): Promise<EntityKind[]> {
  return (await readTableKinds(admin, owner.type, owner.id, kinds)) as EntityKind[];
}

/**
 * Copia di `data` in cui le collezioni `tableKinds` sono lette dalle tabelle (al posto di quelle del blocco); le altre chiavi restano le stesse.
 * Senza tipi `table` restituisce `data` stesso (stesso oggetto, nessuna chiamata). Se la lettura delle tabelle fallisce LANCIA: il chiamante decide come degradare
 * (una collezione 'table' letta dal blocco sarebbe vuota, quindi mai un ripiego silenzioso sul blocco).
 */
export async function readKindsFromTables(admin: SupabaseClient, owner: EntityOwner, data: Json, tableKinds: readonly EntityKind[]): Promise<Json> {
  if (!tableKinds.length) return data;
  const fromTables = await buildBlockData(admin, owner, { kinds: [...tableKinds] });
  return { ...data, ...fromTables };
}

export interface StoreOverlay { data: Json; tableKinds: EntityKind[] }

/** Le due cose insieme: `data` + i tipi 'table' ricostruiti dalle tabelle. Lancia solo se la lettura delle tabelle (con autorita' gia' confermata) fallisce. */
export async function overlayTableKinds(admin: SupabaseClient, owner: EntityOwner, data: Json, kinds: readonly EntityKind[] = STORE_KINDS): Promise<StoreOverlay> {
  const tableKinds = await tableKindsOf(admin, owner, kinds);
  if (!tableKinds.length) return { data, tableKinds };
  return { data: await readKindsFromTables(admin, owner, data, tableKinds), tableKinds };
}

/** Solo il dato (comodo per i lettori che non guardano quali tipi sono stati sostituiti). Lancia come overlayTableKinds. */
export async function withTableKinds<T extends Json>(admin: SupabaseClient, owner: EntityOwner, data: T, kinds: readonly EntityKind[] = STORE_KINDS): Promise<T> {
  return (await overlayTableKinds(admin, owner, data, kinds)).data as T;
}

/** Esiste in public.entities una prenotazione con questo id per il proprietario? (controllo economico prima di caricare tutte le prenotazioni). Lancia se la lettura fallisce. */
export async function bookingRowExists(admin: SupabaseClient, owner: EntityOwner, bookingId: string): Promise<boolean> {
  return (await readEntityRows(admin, owner, "bookings", { ids: [bookingId] })).length > 0;
}
