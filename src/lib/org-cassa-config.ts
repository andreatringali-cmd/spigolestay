// Impostazioni di Cassa delle strutture CONDIVISE tra soci (conti, regole di incasso dei portali, conto principale): viaggiano nella riga org_state dell'org,
// così tutti i soci vedono e aggiornano gli stessi conti. Le chiavi sono "piatte" e personali (cassa:conti, cassa:payouts, cassa:conti-prefs): qui si estrae la
// parte che appartiene alle strutture di un'org e si riporta nel locale quella fusa col server. Modulo puro (nessun accesso a storage o rete).
export const CASSA_CONTI_KEY = "spigolestay:cassa:conti";
export const CASSA_PAYOUTS_KEY = "spigolestay:cassa:payouts";
export const CASSA_PREFS_KEY = "spigolestay:cassa:conti-prefs";

type Snap = Record<string, string>;
const parse = (raw: string | undefined): unknown => { if (!raw) return undefined; try { return JSON.parse(raw); } catch { return undefined; } };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
type Conto = { key?: unknown; structureIds?: unknown };

/** Strutture di ogni org (orgId → id delle strutture) dal blob dati. */
export function orgStructureSets(data: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const list = isObj(data) && Array.isArray(data.structures) ? data.structures : [];
  for (const s of list as { id?: unknown; orgId?: unknown }[]) {
    if (!s || typeof s.id !== "string" || typeof s.orgId !== "string" || !s.orgId) continue;
    if (!out.has(s.orgId)) out.set(s.orgId, new Set());
    out.get(s.orgId)!.add(s.id);
  }
  return out;
}

// Un conto è "dell'org" se è assegnato a una o più strutture e TUTTE sono dell'org (i conti non assegnati o misti restano personali).
const ownedBy = (c: Conto, org: Set<string>): boolean => Array.isArray(c?.structureIds) && c.structureIds.length > 0 && c.structureIds.every((s) => typeof s === "string" && org.has(s));
const keyOf = (c: Conto): string | null => (typeof c?.key === "string" ? c.key : null);

/** La parte di impostazioni locali che appartiene all'org (solo le chiavi non vuote: una parte vuota non deve cancellare quella del server). */
export function extractOrgCassaConfig(local: Snap, org: Set<string>): Snap {
  const out: Snap = {};
  const conti = parse(local[CASSA_CONTI_KEY]);
  if (Array.isArray(conti)) { const mine = (conti as Conto[]).filter((c) => ownedBy(c, org)); if (mine.length) out[CASSA_CONTI_KEY] = JSON.stringify(mine); }
  const pay = parse(local[CASSA_PAYOUTS_KEY]);
  if (isObj(pay)) { const mine = Object.fromEntries(Object.entries(pay).filter(([sid]) => org.has(sid))); if (Object.keys(mine).length) out[CASSA_PAYOUTS_KEY] = JSON.stringify(mine); }
  const prefs = parse(local[CASSA_PREFS_KEY]);
  if (isObj(prefs) && isObj(prefs.principalBy)) { const mine = Object.fromEntries(Object.entries(prefs.principalBy).filter(([sid]) => org.has(sid))); if (Object.keys(mine).length) out[CASSA_PREFS_KEY] = JSON.stringify({ principalBy: mine }); }
  return out;
}

/**
 * Riporta nel locale la parte dell'org fusa col server. Ritorna SOLO le chiavi che cambiano (vuoto = niente da fare). L'ordine delle voci locali si conserva
 * (le voci dell'org si sostituiscono sul posto, le nuove vanno in coda): così una sincronizzazione senza novità non cambia nulla e non innesca altri salvataggi.
 */
export function applyOrgCassaConfig(local: Snap, orgMerged: Snap, org: Set<string>): Snap {
  const out: Snap = {};
  const set = (key: string, next: string) => { if (next !== local[key]) out[key] = next; };

  const mConti = parse(orgMerged[CASSA_CONTI_KEY]);
  if (Array.isArray(mConti)) {
    const orgBy = new Map<string, Conto>();
    for (const c of mConti as Conto[]) { const k = keyOf(c); if (k && ownedBy(c, org)) orgBy.set(k, c); }
    const lConti = parse(local[CASSA_CONTI_KEY]);
    const base = Array.isArray(lConti) ? (lConti as Conto[]) : [];
    const used = new Set<string>();
    const next: Conto[] = [];
    for (const c of base) {
      const k = keyOf(c);
      if (k && orgBy.has(k)) { next.push(orgBy.get(k)!); used.add(k); }
      else if (ownedBy(c, org)) continue; // conto dell'org tolto da un altro socio
      else next.push(c);
    }
    for (const [k, c] of orgBy) if (!used.has(k)) next.push(c);
    set(CASSA_CONTI_KEY, JSON.stringify(next));
  }

  const mPay = parse(orgMerged[CASSA_PAYOUTS_KEY]);
  if (isObj(mPay)) {
    const orgPay = Object.fromEntries(Object.entries(mPay).filter(([sid]) => org.has(sid)));
    const lPay = parse(local[CASSA_PAYOUTS_KEY]);
    const base = isObj(lPay) ? lPay : {};
    const next: Record<string, unknown> = {};
    for (const [sid, v] of Object.entries(base)) { if (org.has(sid)) { if (sid in orgPay) next[sid] = orgPay[sid]; } else next[sid] = v; }
    for (const [sid, v] of Object.entries(orgPay)) if (!(sid in next)) next[sid] = v;
    set(CASSA_PAYOUTS_KEY, JSON.stringify(next));
  }

  const mPrefs = parse(orgMerged[CASSA_PREFS_KEY]);
  if (isObj(mPrefs) && isObj(mPrefs.principalBy)) {
    const orgBy = Object.fromEntries(Object.entries(mPrefs.principalBy).filter(([sid]) => org.has(sid)));
    const lPrefs = parse(local[CASSA_PREFS_KEY]);
    const base = isObj(lPrefs) ? lPrefs : {};
    const lBy = isObj(base.principalBy) ? base.principalBy : {};
    const by: Record<string, unknown> = {};
    for (const [sid, v] of Object.entries(lBy)) { if (org.has(sid)) { if (sid in orgBy) by[sid] = orgBy[sid]; } else by[sid] = v; }
    for (const [sid, v] of Object.entries(orgBy)) if (!(sid in by)) by[sid] = v;
    set(CASSA_PREFS_KEY, JSON.stringify({ ...base, principalBy: by }));
  }
  return out;
}
