import type { SupabaseClient } from "@supabase/supabase-js";

// Dati delle STRUTTURE CONDIVISE (Structure.orgId, es. Central Perk) per il Concierge — solo server, SOLA LETTURA.
//
// Il blob personale (app_state) non contiene le strutture condivise: dopo splitByOrg() in authsync.tsx
// strutture / tipologie / camere / prenotazioni di un'organizzazione vivono SOLO in org_state(org_id),
// chiave "spigolestay:data:v1" (gli ospiti restano comunque tutti anche nel personale). Il browser le ricombina con
// combineData(); qui facciamo la stessa cosa lato server (stesse regole: unione per id, le copie org vincono).
// Le organizzazioni si trovano come in /api/public-booking e manage-booking.ts: memberships(user_id) → org_state(org_id).
// NON si scrive mai su org_state.

const DATA_KEY = "spigolestay:data:v1";
const COLLECTIONS = ["structures", "roomTypes", "units", "bookings", "guests"] as const;
type DataObj = Record<string, unknown>;
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

// Dati (DATA_KEY già parsificato) di ogni organizzazione di cui il tenant è membro attivo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadOrgDatas(admin: SupabaseClient<any>, tenantId: string): Promise<DataObj[]> {
  const out: DataObj[] = [];
  try {
    const { data: ms } = await admin.from("memberships").select("org_id, active").eq("user_id", tenantId);
    const orgIds = Array.from(new Set(arr(ms)
      .filter((m) => (m as { active?: boolean }).active !== false)
      .map((m) => String((m as { org_id?: string }).org_id || "")).filter(Boolean))).slice(0, 20);
    for (const orgId of orgIds) {
      const d = await loadOrgData(admin, orgId);
      if (d) out.push(d);
    }
  } catch { /* tabelle assenti o errore di rete: resta il solo personale */ }
  return out;
}

// Dati (DATA_KEY già parsificato) di UNA organizzazione; null se la riga manca o il blob non è valido. Sola lettura.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadOrgData(admin: SupabaseClient<any>, orgId: string): Promise<DataObj | null> {
  try {
    const { data: row } = await admin.from("org_state").select("data").eq("org_id", orgId).maybeSingle();
    const blob = (((row as { data?: unknown } | null)?.data ?? {}) as Record<string, string>) || {};
    const d = JSON.parse(blob[DATA_KEY] || "{}");
    return d && typeof d === "object" ? (d as DataObj) : null;
  } catch { return null; /* blob org non valido o errore di rete: lo salto */ }
}

// Unione personale + org per id (le copie org, che portano orgId, sovrascrivono): stessa regola di combineData().
export function mergeOrgData<T extends DataObj>(personal: T, orgDatas: DataObj[]): T {
  if (!orgDatas.length) return personal;
  const out: DataObj = { ...personal };
  for (const key of COLLECTIONS) {
    const map = new Map<string, unknown>();
    const add = (list: unknown[]) => {
      for (const it of list) {
        const id = it && typeof it === "object" ? (it as { id?: unknown }).id : undefined;
        map.set(id != null && id !== "" ? String(id) : JSON.stringify(it), it);
      }
    };
    add(arr(personal[key]));
    for (const od of orgDatas) add(arr(od[key]));
    out[key] = [...map.values()];
  }
  return out as T;
}

// Comodo per i chiamanti: legge le org e fonde in un colpo solo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withOrgData<T extends DataObj>(admin: SupabaseClient<any>, tenantId: string, personal: T): Promise<T> {
  return mergeOrgData(personal, await loadOrgDatas(admin, tenantId));
}
