// Decisione (pura) su quale organizzazione riusare quando un utente condivide una struttura che risulta GIÀ presente
// in una o più organizzazioni (org_state). Evita l'escalation: nessuno può farsi inserire come "owner" in un'org altrui
// semplicemente conoscendo l'id di una struttura.

export type OrgReuseDecision =
  | { action: "create" }                    // nessuna org contiene la struttura: si crea una nuova org
  | { action: "use"; orgId: string }        // il chiamante è già membro di (almeno) una org che la contiene: si riusa
  | { action: "forbidden" };                // la struttura sta solo in org di cui il chiamante NON è membro

/**
 * @param orgsWithStructure id delle org (org_state) che contengono la struttura
 * @param callerOrgIds      id delle org di cui il chiamante è già membro (tabella memberships)
 */
export function decideOrgReuse(orgsWithStructure: readonly string[], callerOrgIds: readonly string[]): OrgReuseDecision {
  if (!orgsWithStructure.length) return { action: "create" };
  const mine = new Set(callerOrgIds);
  const own = orgsWithStructure.find((o) => mine.has(o));
  return own ? { action: "use", orgId: own } : { action: "forbidden" };
}
