// Struttura di APERTURA. All'apertura dell'app su un dispositivo la vista parte da UNA struttura sola: la PRINCIPALE (la prima dell'elenco ordinato, quello che il titolare
// riordina da Strutture) oppure quella scelta come «Struttura di apertura». Qui la parte pura (senza browser): ordinamento, preferenza e risoluzione della selezione,
// così lo stesso calcolo lo usano lo store (cosa mostrare) e la sincronizzazione (quali strutture scaricare per prime).

export const HOME_PREF_KEY = "spigolestay:homestruct";        // preferenza: id struttura | "last" (l'ultima usata) | "all" (tutte). Assente = struttura principale
export const HOME_APPLIED_KEY = "spigolestay:homeapplied";     // sessionStorage: la struttura di apertura è già stata applicata in questa sessione (i ricaricamenti mantengono la scelta fatta)
export const START_HINT_KEY = "xn-delta-start";                // per dispositivo: quali strutture scaricare all'avvio (id[] oppure "all"), calcolato la volta prima

export interface StructLite { id: string; orgId?: string; order?: number; name?: string }

/** Stesso ordine usato ovunque nell'app: prima le PROPRIE (senza orgId), poi le CONDIVISE; dentro ciascun gruppo per «order» e infine per nome. */
export function sortStructures<T extends StructLite>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const pa = a.orgId ? 1 : 0, pb = b.orgId ? 1 : 0;
    if (pa !== pb) return pa - pb;
    const oa = typeof a.order === "number" ? a.order : 1e9;
    const ob = typeof b.order === "number" ? b.order : 1e9;
    return oa !== ob ? oa - ob : (a.name || "").localeCompare(b.name || "", "it");
  });
}

/** Selezione nello stesso modello dello store: `active` = "all" o un id; `subset` = 2+ strutture (allora active resta "all"). */
export interface Selection { active: string; subset: string[] }

function fromSaved(sortedIds: string[], savedActive: string | null, savedSubset: string | null): Selection | null {
  const valid = (id: string) => sortedIds.includes(id);
  const subset = (savedSubset || "").split(",").filter(Boolean).filter(valid);
  if (subset.length >= 2 && subset.length < sortedIds.length) return { active: "all", subset };
  if (savedActive === "all") return { active: "all", subset: [] };
  if (savedActive && valid(savedActive)) return { active: savedActive, subset: [] };
  return null;
}

/**
 * Cosa mostrare all'apertura.
 *  - `sessionApplied` (ricaricamento nella stessa sessione): si mantiene l'ultima scelta salvata (in mancanza, la principale);
 *  - altrimenti dipende dalla preferenza: id struttura → quella (se esiste ancora); «last» → l'ultima usata; «all» → tutte; assente/non valida → la PRINCIPALE.
 * Senza strutture: «all» (non c'è nulla da scegliere).
 */
export function resolveSelection(o: { pref: string | null | undefined; sortedIds: string[]; savedActive: string | null; savedSubset: string | null; sessionApplied: boolean }): Selection {
  const { sortedIds } = o;
  if (!sortedIds.length) return { active: "all", subset: [] };
  const main: Selection = { active: sortedIds[0], subset: [] };
  const pref = (o.pref || "").trim();
  if (o.sessionApplied) return fromSaved(sortedIds, o.savedActive, o.savedSubset) ?? main;
  if (pref === "all") return { active: "all", subset: [] };
  if (pref === "last") return fromSaved(sortedIds, o.savedActive, o.savedSubset) ?? main;
  if (pref && sortedIds.includes(pref)) return { active: pref, subset: [] };
  return main;
}

/** Strutture della selezione: elenco di id, oppure "all". */
export function selectionIds(sel: Selection, sortedIds: string[]): string[] | "all" {
  if (sel.subset.length >= 2) return sel.subset;
  if (sel.active === "all") return "all";
  return sortedIds.includes(sel.active) ? [sel.active] : "all";
}

/** Cosa scaricare per prima alla PROSSIMA apertura (hint da ricordare): la selezione che l'apertura darà. */
export function nextOpenHint(pref: string | null | undefined, sortedIds: string[], savedActive: string | null, savedSubset: string | null): string[] | "all" {
  return selectionIds(resolveSelection({ pref, sortedIds, savedActive, savedSubset, sessionApplied: false }), sortedIds);
}

export function parseStartHint(raw: string | null | undefined): string[] | "all" | null {
  if (!raw) return null;
  if (raw === "all" || raw === '"all"') return "all";
  try { const p = JSON.parse(raw); if (Array.isArray(p)) { const ids = p.filter((x): x is string => typeof x === "string" && x !== ""); return ids.length ? ids : null; } } catch { /* illeggibile: sconosciuto */ }
  return null;
}
export function serializeStartHint(h: string[] | "all"): string { return h === "all" ? "all" : JSON.stringify(h); }

/**
 * Strutture da chiedere al server PRIMA di conoscere l'elenco (i dati delle strutture arrivano proprio da quella prima lettura):
 *  - ricaricamento nella stessa sessione: l'ultima scelta salvata (id / sottoinsieme / tutte);
 *  - altrimenti l'hint della volta scorsa;
 *  - nessuna indicazione: null (= «nessuna struttura», si scaricano solo strutture e camere, poi si completa).
 */
export function startRequest(o: { sessionApplied: boolean; savedActive: string | null; savedSubset: string | null; hintRaw: string | null | undefined }): string[] | "all" | null {
  if (o.sessionApplied) {
    const sub = (o.savedSubset || "").split(",").filter(Boolean);
    if (sub.length >= 2) return sub;
    if (o.savedActive === "all") return "all";
    if (o.savedActive) return [o.savedActive];
  }
  return parseStartHint(o.hintRaw);
}
