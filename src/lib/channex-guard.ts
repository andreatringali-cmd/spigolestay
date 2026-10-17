// Controlli di PROPRIETÀ per le route Channex: si tocca solo ciò che è di un proprio immobile (o di una struttura condivisa di cui si è soci).
import type { SupabaseClient } from "@supabase/supabase-js";

/** Id delle organizzazioni di cui l'utente è socio ATTIVO (un socio disattivato non deve più leggere né scrivere nulla). */
export function activeOrgIds(rows: unknown): string[] {
  return ((rows ?? []) as { org_id?: string; active?: boolean | null }[])
    .filter((m) => m.active !== false)
    .map((m) => m.org_id)
    .filter((x): x is string => !!x);
}

/** Id delle property Channex collegate a questo utente (direttamente o tramite una struttura condivisa). */
export async function allowedChannexProperties(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { data: own } = await admin.from("channex_map").select("channex_property_id").eq("tenant_id", userId);
  for (const r of (own ?? []) as { channex_property_id?: string }[]) if (r.channex_property_id) out.add(r.channex_property_id);
  const { data: mem } = await admin.from("memberships").select("org_id, active").eq("user_id", userId);
  const orgIds = activeOrgIds(mem);
  if (orgIds.length) {
    const { data: byOrg } = await admin.from("channex_map").select("channex_property_id").in("org_id", orgIds);
    for (const r of (byOrg ?? []) as { channex_property_id?: string }[]) if (r.channex_property_id) out.add(r.channex_property_id);
  }
  return out;
}

/** La property è già collegata a un ALTRO utente/organizzazione? (impedisce di "rubarne" la mappatura). */
export async function propertyTakenByOthers(admin: SupabaseClient, userId: string, propertyId: string): Promise<boolean> {
  const { data } = await admin.from("channex_map").select("tenant_id, org_id").eq("channex_property_id", propertyId);
  const rows = (data ?? []) as { tenant_id?: string; org_id?: string | null }[];
  if (!rows.length) return false;
  const allowed = await allowedChannexProperties(admin, userId);
  return !allowed.has(propertyId);
}

/** Righe di channex_map visibili a questo utente (proprie o di una struttura condivisa), con le tipologie camera mappate. */
export async function allowedChannexMapRows(admin: SupabaseClient, userId: string): Promise<{ propertyId: string; roomTypeIds: string[] }[]> {
  const out: { propertyId: string; roomTypeIds: string[] }[] = [];
  const push = (rows: unknown) => {
    for (const r of (rows ?? []) as { channex_property_id?: string; rooms?: Record<string, string> | null }[]) {
      if (r.channex_property_id) out.push({ propertyId: r.channex_property_id, roomTypeIds: Object.keys(r.rooms ?? {}) });
    }
  };
  const { data: own } = await admin.from("channex_map").select("channex_property_id, rooms").eq("tenant_id", userId);
  push(own);
  const { data: mem } = await admin.from("memberships").select("org_id, active").eq("user_id", userId);
  const orgIds = activeOrgIds(mem);
  if (orgIds.length) {
    const { data: byOrg } = await admin.from("channex_map").select("channex_property_id, rooms").in("org_id", orgIds);
    push(byOrg);
  }
  return out;
}

/** Accesso a Channex iniettato (così la logica resta pura e testabile). */
export interface RatePlanLookup {
  listRoomTypeIds(propertyId: string): Promise<string[]>;
  listRatePlanIds(roomTypeId: string): Promise<string[]>;
}

/**
 * Il piano tariffario appartiene a una delle property indicate? `ratePlanId` arriva dal client e l'account Channex è
 * condiviso fra tutti i tenant: senza questo controllo si potrebbe modificare il piano di un altro hotel.
 * Prima prova le tipologie già in channex_map (nessuna chiamata di elenco), poi quelle elencate da Channex.
 */
export async function ratePlanBelongsTo(ratePlanId: string, props: { propertyId: string; roomTypeIds: string[] }[], api: RatePlanLookup): Promise<boolean> {
  if (!ratePlanId) return false;
  const seen = new Set<string>();
  const has = async (rtId: string) => {
    if (!rtId || seen.has(rtId)) return false;
    seen.add(rtId);
    return (await api.listRatePlanIds(rtId)).includes(ratePlanId);
  };
  for (const p of props) for (const rt of p.roomTypeIds) if (await has(rt)) return true;
  for (const p of props) for (const rt of await api.listRoomTypeIds(p.propertyId)) if (await has(rt)) return true;
  return false;
}

/** Collaboratore invitato da "Utenti" (non un titolare che co-gestisce la struttura di un socio): lavora sull'account di chi lo ha invitato. */
export async function isCollaborator(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const email = u?.user?.email;
  if (!email) return false;
  const { data: al } = await admin.from("access_allowlist").select("kind").ilike("email", email).maybeSingle();
  return al?.kind === "collaboratore";
}
