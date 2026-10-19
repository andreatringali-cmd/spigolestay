// Impostazioni dell'account di lavoro: le chiavi "spigolestay:*" che appartengono all'ATTIVITÀ (non alla persona) e che un collaboratore deve
// leggere e scrivere sul server, uguali a quelle del titolare. Le preferenze personali (tema, lingua, viste, notifiche, utente corrente) restano
// per persona. Deve restare allineata al filtro lato server (ws_deny nella migrazione 0015).
const P = "spigolestay:";

const EXACT = [
  "plan", "tier", "modules", "sito", "guides", "images", "promos", "promosseeded", "widget", "widgets:v1", "deposit", "todo:v1", "daynotes",
  "rateplans", "rateplans:seed", "ratemodel", "pricerules", "paysettings", "preventivi", "threads:v1", "msgtemplates", "msgtemplates:deleted", "msgoverrides", "msgsent", "reviews",
  "calcloses", "calcta", "calctd", "inventorypool", "localevents", "extrasseeded", "metasearch:v2", "metasearch:dest", "nettare:strategy",
  "aiconcierge", "concierge:unanswered:v1", "roomaccess", "revenueapplied", "autopilot", "channexmap", "google-content-result",
  "canali:conn", "canali:enabled", "canali:colors", "canali:log", "canali:corrlog",
  "cassa:conti", "cassa:conti-prefs", "cassa:payouts", "cassa:overrides", "cassa:v1", "cassa:migrated",
  "reviewsettings", "pulizie:done", "pulizie:stock", "pulizie:issues", "pulizie:linen", "pulizie:notes", "pulizie:orders", "pulizie:autoshare", "pulizie:tasks", "pulizie:checks", "pulizie:hours",
].map((k) => P + k);

// chiavi con suffisso (per struttura): pulizie:autoshare:<id>, sito:<id>, reviews:placeid:<id>, ratecheck:*, style:*
const PREFIXES = ["pulizie:autoshare:", "sito:", "reviews:", "ratecheck:", "style:", "autopilot:"].map((k) => P + k);

export function isWorkspaceKey(k: string): boolean {
  return EXACT.includes(k) || PREFIXES.some((p) => k.startsWith(p));
}

/** Tutte le chiavi dell'account di lavoro presenti ora nel browser (per scoprire anche quelle con suffisso). */
export function localWorkspaceKeys(): string[] {
  const out = new Set<string>(EXACT);
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && isWorkspaceKey(k)) out.add(k); } } catch { /* niente */ }
  return [...out];
}
export const WORKSPACE_EXACT_KEYS = EXACT;
export const WORKSPACE_PREFIXES = PREFIXES;
