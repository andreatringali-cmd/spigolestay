// Controlli LATO SERVER sulle prenotazioni dirette (sito/widget): il browser dell'ospite non è affidabile.
//  - prezzo minimo: nessuno può prenotare un soggiorno da 2000 € pagando 1 €;
//  - disponibilità: niente prenotazione sovrapposta a una già esistente (o a un blocco/manutenzione).
import type { SupabaseClient } from "@supabase/supabase-js";
import { rateForDay } from "@/lib/pricing";
import type { RoomType } from "@/lib/types";
import { buildBlockData, diffBlockParts, diffValues, entitiesSwitch, readBookings, readRateOverrides, readRoomTypes, readStructureAcrossOwners, readUnits, type EntityOwner } from "@/lib/server-entities";

// Le letture di questo file seguono l'interruttore SERVER_READ_ENTITIES (off | compare | on, vedi server-entities.ts / SERVER-ENTITIES.md):
// con "on" strutture, tipologie, camere e prenotazioni vengono dalle tabelle (public.entities) invece che dal blocco. Le scritture dei chiamanti non cambiano.
// Le organizzazioni di cui il proprietario e' membro si leggono sempre da memberships (invariato).
async function orgIdsOf(admin: SupabaseClient, ownerId: string): Promise<string[]> {
  const { data: ms, error } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
  if (error) throw new Error("memberships: " + error.message);
  return arr(ms).map((m) => String(m.org_id || "")).filter(Boolean);
}
// Proprietari in ordine di fiducia (come nel blocco): prima le organizzazioni, poi il personale.
const ownersOf = (orgIds: string[], ownerId: string): EntityOwner[] => [...orgIds.map((id) => ({ type: "o" as const, id })), { type: "u" as const, id: ownerId }];
const PART_KINDS = ["structures", "roomTypes", "units", "bookings"] as const;

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const parse = (data: unknown): Json => { try { return JSON.parse(String((data as Record<string, string> | null)?.[DATA_KEY] || "{}")) as Json; } catch { return {}; } };

export interface OwnerStructureData { roomTypes: RoomType[]; units: Json[]; bookings: Json[]; rateOverrides: Record<string, number> }

/** Dati della struttura del proprietario: dal suo stato personale oppure, se è condivisa, da quello dell'organizzazione. */
export async function loadOwnerStructureData(admin: SupabaseClient, ownerId: string, sid: string): Promise<OwnerStructureData | null> {
  return entitiesSwitch<OwnerStructureData | null>({
    label: "loadOwnerStructureData",
    legacy: () => loadOwnerStructureDataFromBlock(admin, ownerId, sid),
    tables: () => loadOwnerStructureDataFromTables(admin, ownerId, sid),
    diff: (a, b) => (a && b ? diffBlockParts([a as unknown as Json], [b as unknown as Json], ["roomTypes", "units", "bookings"], { rates: true }) : a === b ? null : { block: a ? "dati" : null, tables: b ? "dati" : null }),
  });
}
async function loadOwnerStructureDataFromTables(admin: SupabaseClient, ownerId: string, sid: string): Promise<OwnerStructureData | null> {
  const owners = ownersOf(await orgIdsOf(admin, ownerId), ownerId);
  const has = await readStructureAcrossOwners(admin, owners, sid);
  const owner = owners.find((o) => has.has(o.type + ":" + o.id));
  if (!owner) return null;
  const [roomTypes, units, bookings, rates] = await Promise.all([readRoomTypes(admin, owner), readUnits(admin, owner), readBookings(admin, owner), readRateOverrides(admin, owner)]);
  return { roomTypes: roomTypes as unknown as RoomType[], units, bookings, rateOverrides: rates.map };
}
async function loadOwnerStructureDataFromBlock(admin: SupabaseClient, ownerId: string, sid: string): Promise<OwnerStructureData | null> {
  const pick = (d: Json): OwnerStructureData | null => {
    if (!arr(d.structures).some((s) => s.id === sid)) return null;
    return { roomTypes: arr(d.roomTypes) as unknown as RoomType[], units: arr(d.units), bookings: arr(d.bookings), rateOverrides: (d.rateOverrides && typeof d.rateOverrides === "object" ? d.rateOverrides : {}) as Record<string, number> };
  };
  try {
    const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
    for (const m of arr(ms)) {
      const { data: os } = await admin.from("org_state").select("data").eq("org_id", m.org_id as string).maybeSingle();
      const r = pick(parse((os as { data?: unknown } | null)?.data));
      if (r) return r;
    }
    const { data: row } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
    return pick(parse((row as { data?: unknown } | null)?.data));
  } catch { return null; }
}

/** Dati (spigolestay:data:v1 già letti) di tutte le organizzazioni di cui l'utente è membro: le strutture condivise stanno solo lì, non nello stato personale. */
export async function loadOrgDataParts(admin: SupabaseClient, ownerId: string): Promise<Json[]> {
  return entitiesSwitch<Json[]>({
    label: "loadOrgDataParts",
    legacy: () => loadOrgDataPartsFromBlock(admin, ownerId),
    tables: async () => Promise.all((await orgIdsOf(admin, ownerId)).map((id) => buildBlockData(admin, { type: "o", id }, { kinds: [...PART_KINDS], rateOverrides: true }))),
    diff: (a, b) => diffBlockParts(a, b, PART_KINDS, { rates: true }),
  });
}
async function loadOrgDataPartsFromBlock(admin: SupabaseClient, ownerId: string): Promise<Json[]> {
  const out: Json[] = [];
  try {
    const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
    for (const m of arr(ms)) {
      const { data: os } = await admin.from("org_state").select("data").eq("org_id", m.org_id as string).maybeSingle();
      out.push(parse((os as { data?: unknown } | null)?.data));
    }
  } catch { /* best-effort: si usano i dati che ci sono */ }
  return out;
}

export interface MergedOwnerData { structures: Json[]; roomTypes: Json[]; units: Json[]; bookings: Json[]; rateOverrides: Record<string, number> }

/** Unisce più blob di dati (personale + organizzazioni) senza doppioni per id: vale la prima occorrenza (passare per primo il blob personale). */
export function mergeOwnerData(parts: Json[]): MergedOwnerData {
  const uniq = (key: string): Json[] => {
    const seen = new Set<string>();
    const out: Json[] = [];
    for (const p of parts) for (const x of arr(p[key])) { const id = typeof x.id === "string" ? x.id : ""; if (id) { if (seen.has(id)) continue; seen.add(id); } out.push(x); }
    return out;
  };
  const rateOverrides: Record<string, number> = {};
  for (const p of [...parts].reverse()) if (p.rateOverrides && typeof p.rateOverrides === "object") Object.assign(rateOverrides, p.rateOverrides);
  return { structures: uniq("structures"), roomTypes: uniq("roomTypes"), units: uniq("units"), bookings: uniq("bookings"), rateOverrides };
}

const nightsList = (ci: string, co: string): string[] => {
  const out: string[] = [];
  const end = Date.parse(co + "T00:00:00Z");
  for (let t = Date.parse(ci + "T00:00:00Z"); t < end && out.length < 400; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

/** Totale minimo accettabile: metà del prezzo di listino del soggiorno (le promozioni legittime non scendono sotto). null = prezzi non impostati, nessun controllo. */
export function stayFloor(d: OwnerStructureData, rtId: string, ci: string, co: string): number | null {
  const sum = nightsList(ci, co).reduce((a, iso) => a + rateForDay(rtId, iso, d.roomTypes, d.rateOverrides, 0), 0);
  return sum > 0 ? Math.floor(sum * 0.5) : null;
}

const overlaps = (b: { checkIn?: unknown; checkOut?: unknown }, ci: string, co: string) => String(b.checkIn) < co && String(b.checkOut) > ci;

/** Vero se esiste almeno una camera della tipologia libera nelle date (blocchi e manutenzioni contano come occupato). null = non verificabile (nessuna camera trovata). */
export function hasFreeUnit(d: OwnerStructureData, rtId: string, ci: string, co: string): boolean | null {
  const ofType = d.units.filter((u) => u.roomTypeId === rtId && !u.outOfService);
  if (!ofType.length) return null;
  return ofType.some((u) => !d.bookings.some((b) => b.unitId === u.id && b.status !== "cancelled" && overlaps(b, ci, co)));
}

/** Primo IP della richiesta (per i limiti di frequenza). */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

/** Data di calendario reale (rifiuta 2026-02-30 e simili: il solo formato non basta, Date.parse("2026-02-30") sfora a marzo). */
export function isRealIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * La struttura `sid` (con il suo stripeAccount) tra i dati del proprietario: prima le organizzazioni condivise di cui è membro
 * (fonte di verità per le strutture in società, evita copie personali vecchie con un conto di test), poi il suo stato personale.
 * null = la struttura NON appartiene a questo utente. È l'unico modo fidato di sapere su quale conto Stripe incassare.
 */
export async function findOwnerStructure(admin: SupabaseClient, ownerId: string, sid: string): Promise<Json | null> {
  if (!ownerId || !sid) return null;
  return entitiesSwitch<Json | null>({
    label: "findOwnerStructure",
    legacy: () => findOwnerStructureFromBlock(admin, ownerId, sid),
    tables: async () => {
      const orgIds = await orgIdsOf(admin, ownerId);
      const found = await readStructureAcrossOwners(admin, ownersOf(orgIds, ownerId), sid);
      let orgSt: Json | null = null;
      for (const id of orgIds) {
        const s = found.get("o:" + id);
        if (s) { orgSt = s; if (s.stripeAccount) return s; }
      }
      const perSt = found.get("u:" + ownerId) ?? null;
      if (perSt?.stripeAccount) return perSt;
      return orgSt || perSt;
    },
    diff: (a, b) => diffValues(a, b),
  });
}
async function findOwnerStructureFromBlock(admin: SupabaseClient, ownerId: string, sid: string): Promise<Json | null> {
  try {
    let orgSt: Json | null = null;
    const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
    for (const m of arr(ms)) {
      const { data: os } = await admin.from("org_state").select("data").eq("org_id", m.org_id as string).maybeSingle();
      const found = arr(parse((os as { data?: unknown } | null)?.data).structures).find((s) => s.id === sid);
      if (found) { orgSt = found; if (found.stripeAccount) return found; }
    }
    const { data: row } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
    const perSt = arr(parse((row as { data?: unknown } | null)?.data).structures).find((s) => s.id === sid) || null;
    if (perSt?.stripeAccount) return perSt;
    return orgSt || perSt;
  } catch { return null; }
}

/** Piani tariffari (spigolestay:rateplans) del proprietario, come stringa JSON già parsificata. null = nessuno salvato (vale l'elenco predefinito). */
export function ratePlansFromBlob(blob: unknown): unknown[] | null {
  try {
    const raw = (blob as Record<string, string> | null)?.["spigolestay:rateplans"];
    const a = raw ? JSON.parse(raw) : null;
    return Array.isArray(a) && a.length ? a : null;
  } catch { return null; }
}

export async function loadOwnerRatePlans(admin: SupabaseClient, ownerId: string): Promise<unknown[] | null> {
  const read = ratePlansFromBlob;
  try {
    const { data: row } = await admin.from("app_state").select("data").eq("user_id", ownerId).maybeSingle();
    const own = read((row as { data?: unknown } | null)?.data);
    if (own) return own;
    const { data: ms } = await admin.from("memberships").select("org_id").eq("user_id", ownerId);
    for (const m of arr(ms)) {
      const { data: os } = await admin.from("org_state").select("data").eq("org_id", m.org_id as string).maybeSingle();
      const o = read((os as { data?: unknown } | null)?.data);
      if (o) return o;
    }
  } catch { /* nessun piano leggibile: valgono quelli predefiniti */ }
  return null;
}

/** L'account Stripe collegato può incassare? true/false se Stripe risponde, null se non verificabile (errore di rete: non si blocca, deciderà Checkout). */
export async function stripeAccountChargesEnabled(stripe: { accounts: { retrieve: (id: string) => Promise<{ charges_enabled?: boolean }> } }, acct: string): Promise<boolean | null> {
  try {
    const a = await stripe.accounts.retrieve(acct);
    return a.charges_enabled === undefined ? null : !!a.charges_enabled;
  } catch { return null; }
}
