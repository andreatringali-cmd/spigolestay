// Ordinamento camere coerente in tutta l'app: per nome, numerico ("2" prima di "10", "7" dopo "6").
// Stessa logica della tabella Camere, così il planner e le altre viste non vanno mai fuori ordine.
export function byUnitName<T extends { name?: string }>(a: T, b: T): number {
  return (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true });
}

export function sortUnitsByName<T extends { name?: string }>(list: readonly T[]): T[] {
  return [...list].sort(byUnitName);
}
