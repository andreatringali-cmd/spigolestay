// Controlli LATO SERVER sulle prenotazioni dirette (sito/widget): il browser dell'ospite non è affidabile.
//  - prezzo minimo: nessuno può prenotare un soggiorno da 2000 € pagando 1 €;
//  - disponibilità: niente prenotazione sovrapposta a una già esistente (o a un blocco/manutenzione).
import type { SupabaseClient } from "@supabase/supabase-js";
import { rateForDay } from "@/lib/pricing";
import type { RoomType } from "@/lib/types";

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const parse = (data: unknown): Json => { try { return JSON.parse(String((data as Record<string, string> | null)?.[DATA_KEY] || "{}")) as Json; } catch { return {}; } };

export interface OwnerStructureData { roomTypes: RoomType[]; units: Json[]; bookings: Json[]; rateOverrides: Record<string, number> }

/** Dati della struttura del proprietario: dal suo stato personale oppure, se è condivisa, da quello dell'organizzazione. */
export async function loadOwnerStructureData(admin: SupabaseClient, ownerId: string, sid: string): Promise<OwnerStructureData | null> {
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
