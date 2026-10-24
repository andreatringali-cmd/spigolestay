import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBlockData, diffBlockParts, entitiesSwitch, MERGE_KINDS } from "./server-entities";
import { withTableKinds } from "./server-entities-store";

// Dati delle STRUTTURE CONDIVISE (Structure.orgId, es. Central Perk) per il Concierge — solo server, SOLA LETTURA.
//
// Il blob personale (app_state) non contiene le strutture condivise: dopo splitByOrg() in authsync.tsx
// strutture / tipologie / camere / prenotazioni di un'organizzazione vivono SOLO in org_state(org_id),
// chiave "spigolestay:data:v1" (gli ospiti restano comunque tutti anche nel personale). Il browser le ricombina con
// combineData(); qui facciamo la stessa cosa lato server (stesse regole: unione per id, le copie org vincono).
// Le organizzazioni si trovano come in /api/public-booking e manage-booking.ts: memberships(user_id) → org_state(org_id).
// NON si scrive mai su org_state.
//
// Interruttore SERVER_READ_ENTITIES (off | compare | on, vedi server-entities.ts e SERVER-ENTITIES.md): con "on" le collezioni vengono
// dalle tabelle (public.entities) invece che dal blocco; "off" e' il comportamento di sempre.

const DATA_KEY = "spigolestay:data:v1";
const COLLECTIONS = ["structures", "roomTypes", "units", "bookings", "guests"] as const;
type DataObj = Record<string, unknown>;
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

// Organizzazioni di cui il tenant e' membro attivo (come prima: massimo 20, senza doppioni). Errore di rete o tabella assente = nessuna.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function activeOrgIds(admin: SupabaseClient<any>, tenantId: string): Promise<string[]> {
  try {
    const { data: ms } = await admin.from("memberships").select("org_id, active").eq("user_id", tenantId);
    return Array.from(new Set(arr(ms)
      .filter((m) => (m as { active?: boolean }).active !== false)
      .map((m) => String((m as { org_id?: string }).org_id || "")).filter(Boolean))).slice(0, 20);
  } catch { return []; }
}

// Dati (DATA_KEY già parsificato) di ogni organizzazione di cui il tenant è membro attivo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOrgDatasFromBlock(admin: SupabaseClient<any>, tenantId: string): Promise<DataObj[]> {
  const out: DataObj[] = [];
  try {
    const orgIds = await activeOrgIds(admin, tenantId);
    for (const orgId of orgIds) {
      const d = await loadOrgDataFromBlock(admin, orgId);
      if (d) out.push(d);
    }
  } catch { /* tabelle assenti o errore di rete: resta il solo personale */ }
  return out;
}
// Stessi dati, ricostruiti dalle tabelle (le cinque collezioni che usa mergeOrgData). Un errore di lettura SOLLEVA: lo gestisce l'interruttore.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOrgDatasFromTables(admin: SupabaseClient<any>, tenantId: string): Promise<DataObj[]> {
  const orgIds = await activeOrgIds(admin, tenantId);
  return Promise.all(orgIds.map((id) => buildBlockData(admin, { type: "o", id }, { kinds: MERGE_KINDS })));
}
const diffOrgDatas = (a: DataObj[], b: DataObj[]) => diffBlockParts(a, b, COLLECTIONS);

// Dati (DATA_KEY già parsificato) di UNA organizzazione; null se la riga manca o il blob non è valido. Sola lettura.
// Fase 3 (docs/FASE3-STORE-DA-TABELLE.md): le collezioni con autorità 'table' per quell'org (blocco vuoto) si rileggono dalle tabelle; senza SERVER_WRITE_ENTITIES=on, riga di
// autorità o con un errore nel leggerla il dato è esattamente quello del blocco. Tabelle illeggibili con autorità 'table' = org saltata (come un errore di rete).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOrgDataFromBlock(admin: SupabaseClient<any>, orgId: string): Promise<DataObj | null> {
  try {
    const { data: row } = await admin.from("org_state").select("data").eq("org_id", orgId).maybeSingle();
    const blob = (((row as { data?: unknown } | null)?.data ?? {}) as Record<string, string>) || {};
    const d = JSON.parse(blob[DATA_KEY] || "{}");
    return d && typeof d === "object" ? await withTableKinds(admin, { type: "o", id: orgId }, d as DataObj, MERGE_KINDS) : null;
  } catch { return null; /* blob org non valido o errore di rete: lo salto */ }
}

// Dati di ogni organizzazione di cui il tenant è membro attivo (dal blocco o, con SERVER_READ_ENTITIES=on, dalle tabelle).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadOrgDatas(admin: SupabaseClient<any>, tenantId: string): Promise<DataObj[]> {
  return entitiesSwitch<DataObj[]>({
    label: "loadOrgDatas",
    legacy: () => loadOrgDatasFromBlock(admin, tenantId),
    tables: () => loadOrgDatasFromTables(admin, tenantId),
    diff: diffOrgDatas,
  });
}

// Dati di UNA organizzazione; null se non valida (dal blocco). Con "on" dalle tabelle (un'organizzazione senza righe da' un oggetto con liste vuote).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadOrgData(admin: SupabaseClient<any>, orgId: string): Promise<DataObj | null> {
  return entitiesSwitch<DataObj | null>({
    label: "loadOrgData",
    legacy: () => loadOrgDataFromBlock(admin, orgId),
    tables: () => buildBlockData(admin, { type: "o", id: orgId }, { kinds: MERGE_KINDS }),
    diff: (a, b) => diffBlockParts(a ? [a] : [], b ? [b] : [], COLLECTIONS),
  });
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

// Dati COMPLETI del tenant (personale + strutture condivise) per i lettori che servono solo strutture / tipologie / camere / prenotazioni / ospiti
// (Alloggiati Web, ISTAT): con "off" e "compare" il blocco personale si legge come sempre; con "on" anche il personale viene dalle tabelle e il blocco non si scarica piu'.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadTenantData(admin: SupabaseClient<any>, tenantId: string): Promise<DataObj> {
  const fromBlock = async (): Promise<DataObj> => {
    const { data } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
    let personal: DataObj = {};
    try { personal = JSON.parse(((data?.data ?? {}) as Record<string, string>)[DATA_KEY] || "{}") as DataObj; } catch { personal = {}; }
    // Fase 3: collezioni personali con autorità 'table' dalle tabelle; se non si leggono resta il blocco (mai un'eccezione: in compare il risultato del blocco deve arrivare).
    try { personal = await withTableKinds(admin, { type: "u", id: tenantId }, personal, MERGE_KINDS); } catch (e) { console.error("[store-from-tables] loadTenantData personale", e instanceof Error ? e.message : String(e)); }
    return mergeOrgData(personal, await loadOrgDatasFromBlock(admin, tenantId));
  };
  const fromTables = async (): Promise<DataObj> => {
    const [personal, orgs] = await Promise.all([buildBlockData(admin, { type: "u", id: tenantId }, { kinds: MERGE_KINDS }), loadOrgDatasFromTables(admin, tenantId)]);
    return mergeOrgData(personal, orgs);
  };
  return entitiesSwitch<DataObj>({
    label: "loadTenantData",
    legacy: fromBlock,
    tables: fromTables,
    diff: (a, b) => diffBlockParts([a], [b], COLLECTIONS),
  });
}
