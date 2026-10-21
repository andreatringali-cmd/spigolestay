import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBlockData, diffBlockParts, entitiesReadMode, entitiesShadow, readBookings, readGuestsByIds, readRoomTypes, readStructureAcrossOwners, readStructures, readUnits,
  MERGE_KINDS, type EntityKind, type EntityOwner, type Json,
} from "./server-entities";

// Lettori in SOLO CONFRONTO (Fase 3, passo 1): il chiamante legge il blocco come sempre e usa SOLO quel risultato; queste funzioni, quando
// SERVER_READ_ENTITIES=compare, leggono anche le tabelle (public.entities), confrontano e scrivono le differenze in console ([entities-compare] {json}).
//  - off e on: non fanno NULLA (nessuna chiamata a entities): un punto entra in "on" solo quando lo si promuove a mano con entitiesSwitch.
//  - il risultato del chiamante non cambia mai; qualunque errore (tabelle, confronto, rete) e' catturato qui dentro e non arriva alla richiesta;
//  - i confronti "pesanti" (tutti i dati di un proprietario) hanno un limite di frequenza per processo: al massimo uno ogni `everyMs` per punto e proprietario.
// Istruzioni operative e punti coperti: src/lib/SERVER-ENTITIES.md.

const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const str = (x: unknown): string => (x == null ? "" : String(x));
const ownerKey = (o: EntityOwner) => o.type + ":" + o.id;

const lastRun = new Map<string, number>();
/** Solo per i test: azzera il limitatore di frequenza dei confronti. */
export function _resetShadowThrottle() { lastRun.clear(); }
/** Vero se in "compare" e se per questo `key` non c'e' stato un confronto negli ultimi `everyMs` (0 = sempre). */
export function shadowDue(key: string, everyMs = 0): boolean {
  if (entitiesReadMode() !== "compare") return false;
  if (!everyMs) return true;
  const now = Date.now();
  if ((lastRun.get(key) ?? 0) + everyMs > now) return false;
  if (lastRun.size > 500) lastRun.clear();
  lastRun.set(key, now);
  return true;
}
/** Esegue il confronto senza mai far arrivare un errore al chiamante. */
async function safe(fn: () => Promise<void>): Promise<void> { try { await fn(); } catch { /* il confronto non deve mai rompere una richiesta */ } }

/** Le collezioni indicate di uno o piu' proprietari (blocchi gia' letti dal chiamante, nello stesso ordine dei proprietari) contro le tabelle. */
export async function shadowOwnersData(admin: SupabaseClient, label: string, owners: EntityOwner[], fromBlocks: (Json | null | undefined)[], opts: { kinds?: EntityKind[]; everyMs?: number } = {}): Promise<void> {
  await safe(async () => {
    const kinds = opts.kinds ?? MERGE_KINDS;
    if (!shadowDue(label + "|" + owners.map(ownerKey).join(","), opts.everyMs)) return;
    await entitiesShadow<Json[]>(
      label, fromBlocks.map((b) => b ?? {}),
      () => Promise.all(owners.map((o) => buildBlockData(admin, o, { kinds }))),
      undefined, (a, b) => diffBlockParts(a, b, kinds),
    );
  });
}
export const shadowOwnerData = (admin: SupabaseClient, label: string, owner: EntityOwner, fromBlock: Json | null | undefined, opts: { kinds?: EntityKind[]; everyMs?: number } = {}) =>
  shadowOwnersData(admin, label, [owner], [fromBlock], opts);

/** health: nomi delle strutture dell'account (id -> nome, gia' troncato a 60 caratteri come fa la route). */
export async function shadowStructureNames(admin: SupabaseClient, label: string, owner: EntityOwner, fromBlock: Record<string, string>, everyMs = 0): Promise<void> {
  await safe(async () => {
    if (!shadowDue(label + "|" + ownerKey(owner), everyMs)) return;
    await entitiesShadow<Record<string, string>>(label, fromBlock, async () => {
      const out: Record<string, string> = {};
      for (const s of await readStructures(admin, owner)) if (s?.id && s.name) out[str(s.id)] = str(s.name).slice(0, 60);
      return out;
    });
  });
}

/** org/access: la prima struttura di un'organizzazione (id, nome) e quante ce ne sono. */
export async function shadowOrgFirstStructure(admin: SupabaseClient, orgId: string, fromBlock: { id: string; name: string; count: number }): Promise<void> {
  await safe(async () => {
    if (!shadowDue("org/access.firstStructure|" + orgId)) return;
    await entitiesShadow("org/access.firstStructure", fromBlock, async () => {
      const list = await readStructures(admin, { type: "o", id: orgId });
      return { id: str(list[0]?.id), name: str(list[0]?.name), count: list.length };
    });
  });
}

/**
 * org/members, org/leave: in quale organizzazione sta la struttura `structureId` tra quelle (nell'ordine dato) di cui l'utente e' membro.
 * `fromBlock` = id dell'organizzazione trovata scorrendo i blocchi (null = nessuna).
 */
export async function shadowOrgOfStructure(admin: SupabaseClient, label: string, orgIds: string[], structureId: string, fromBlock: string | null): Promise<void> {
  await safe(async () => {
    if (!structureId || !shadowDue(label)) return;
    await entitiesShadow<string | null>(label, fromBlock, async () => {
      const ids = orgIds.filter(Boolean);
      const has = await readStructureAcrossOwners(admin, ids.map((id) => ({ type: "o" as const, id })), structureId);
      return ids.find((id) => has.has("o:" + id)) ?? null;
    });
  });
}

/** stripe-guard: l'utente e' proprietario del conto collegato `acct` secondo i dati (struttura personale, se non esclusa, o delle sue organizzazioni)? */
export async function shadowStripeOwnership(admin: SupabaseClient, userId: string, acct: string, o: { skipPersonal: boolean; orgIds: string[]; fromBlock: boolean }): Promise<void> {
  await safe(async () => {
    if (!shadowDue("stripe-guard.userOwnsStripeAccount")) return;
    await entitiesShadow<boolean>("stripe-guard.userOwnsStripeAccount", o.fromBlock, async () => {
      const has = (list: Json[]) => list.some((s) => s?.stripeAccount === acct);
      if (!o.skipPersonal && has(await readStructures(admin, { type: "u", id: userId }))) return true;
      for (const id of o.orgIds.filter(Boolean)) if (has(await readStructures(admin, { type: "o", id }))) return true;
      return false;
    });
  });
}

const SCOPE_KINDS = ["structures", "roomTypes", "units", "bookings", "guests"] as const;
/** pulizie/send-now: solo i dati di UNA struttura (le sue tipologie, camere, prenotazioni e gli ospiti di quelle prenotazioni) contro le tabelle. */
export async function shadowStructureScope(admin: SupabaseClient, label: string, owner: EntityOwner, sid: string, data: Json, everyMs = 0): Promise<void> {
  await safe(async () => {
    if (!sid || !shadowDue(label + "|" + ownerKey(owner) + "|" + sid, everyMs)) return;
    const mine = (xs: unknown) => arr(xs).filter((x) => x?.structureId === sid);
    const bookings = mine(data.bookings);
    const guestIds = [...new Set(bookings.map((b) => str(b.guestId)).filter(Boolean))];
    const fromBlock: Json = {
      structures: arr(data.structures).filter((s) => s?.id === sid), roomTypes: mine(data.roomTypes), units: mine(data.units), bookings,
      guests: arr(data.guests).filter((g) => guestIds.includes(str(g?.id))),
    };
    await entitiesShadow<Json>(label, fromBlock, async () => {
      const [structures, roomTypes, units, tBookings, guests] = await Promise.all([
        readStructures(admin, owner), readRoomTypes(admin, owner, { structureId: sid }), readUnits(admin, owner, { structureId: sid }),
        readBookings(admin, owner, { structureId: sid }), readGuestsByIds(admin, owner, guestIds),
      ]);
      return { structures: structures.filter((s) => str(s.id) === sid), roomTypes, units, bookings: tBookings, guests };
    }, undefined, (a, b) => diffBlockParts([a], [b], SCOPE_KINDS));
  });
}
