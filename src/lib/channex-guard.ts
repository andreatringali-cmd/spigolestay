// Controlli di PROPRIETÀ per le route Channex: si tocca solo ciò che è di un proprio immobile (o di una struttura condivisa di cui si è soci).
import type { SupabaseClient } from "@supabase/supabase-js";

/** Id delle property Channex collegate a questo utente (direttamente o tramite una struttura condivisa). */
export async function allowedChannexProperties(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { data: own } = await admin.from("channex_map").select("channex_property_id").eq("tenant_id", userId);
  for (const r of (own ?? []) as { channex_property_id?: string }[]) if (r.channex_property_id) out.add(r.channex_property_id);
  const { data: mem } = await admin.from("memberships").select("org_id").eq("user_id", userId);
  const orgIds = ((mem ?? []) as { org_id?: string }[]).map((m) => m.org_id).filter((x): x is string => !!x);
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
