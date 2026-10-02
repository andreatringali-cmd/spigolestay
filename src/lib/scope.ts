// Ambito per struttura: un elemento SENZA structureId vale per tutte le strutture
// (retro-compatibile con i dati salvati prima dell'indipendenza per struttura).
// Con "all" (tutte le strutture) si vede tutto; con una struttura attiva si vedono
// gli elementi di quella struttura + quelli "per tutte".
export function inScope(itemStructureId: string | undefined | null, activeStructureId: string): boolean {
  if (!activeStructureId || activeStructureId === "all") return true;
  return !itemStructureId || itemStructureId === activeStructureId;
}

// Filtra una lista di elementi con structureId opzionale.
export function scopeFilter<T extends { structureId?: string }>(list: T[], activeStructureId: string): T[] {
  if (!activeStructureId || activeStructureId === "all") return list;
  return list.filter((x) => inScope(x.structureId, activeStructureId));
}

// Struttura da assegnare a un NUOVO elemento: la struttura attiva se è una vera struttura,
// altrimenti undefined (= vale per tutte).
export function newItemStructureId(activeStructureId: string): string | undefined {
  return !activeStructureId || activeStructureId === "all" ? undefined : activeStructureId;
}
