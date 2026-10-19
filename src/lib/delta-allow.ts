// Account abilitati alla «modalità veloce» (Fase 2) durante la prova: per ora solo il titolare. Un collaboratore o un altro cliente non vede l'interruttore, la
// modalità non si attiva mai e il server rifiuta le scritture a delta. Per allargare la prova si aggiunge l'uid qui.
export const DELTA_ALLOWED_UIDS: ReadonlySet<string> = new Set<string>(["285dccf2-726b-4120-9efa-88ab576a06f6"]);
export const deltaAllowedFor = (uid: string | null | undefined): boolean => !!uid && DELTA_ALLOWED_UIDS.has(uid);
