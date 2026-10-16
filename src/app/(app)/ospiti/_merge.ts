// Unione dei doppioni in anagrafica (pagina Ospiti). Funzioni pure, testate in tests/guest-merge.test.ts.
// L'unione NON è mai automatica: la pagina mostra l'anteprima e chiede conferma. Qui si decide COSA unire e come.
import type { Guest } from "@/lib/types";
import { normName, normPhone, realEmail, usableName } from "@/lib/guest-key";

const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

const tokens = (s?: string) => normName(s).split(" ").filter(Boolean);
/** Nomi compatibili: uguali (anche con parole in ordine diverso) oppure uno contenuto nell'altro ("Mario Rossi" / "Rossi"). Se uno dei due non ha un nome utilizzabile, non si può dire che siano diversi. */
function nameCompatible(a: Guest, b: Guest): boolean {
  const na = usableName(a.fullName), nb = usableName(b.fullName);
  if (!na || !nb) return true;
  const ta = tokens(a.fullName), tb = tokens(b.fullName);
  const sa = new Set(ta), sb = new Set(tb);
  return ta.every((x) => sb.has(x)) || tb.every((x) => sa.has(x));
}
function sameName(a: Guest, b: Guest): boolean {
  const na = usableName(a.fullName), nb = usableName(b.fullName);
  return !!na && na === nb;
}
/** Paese diverso o due email reali diverse = persone diverse, anche con lo stesso nome. */
function conflicting(a: Guest, b: Guest): boolean {
  const ca = (a.country ?? "").trim().toLowerCase(), cb = (b.country ?? "").trim().toLowerCase();
  if (ca && cb && ca !== cb) return true;
  const ea = realEmail(a.email), eb = realEmail(b.email);
  return !!ea && !!eb && ea !== eb;
}

/**
 * Raffina i gruppi proposti da groupDuplicates: chi condivide SOLO il telefono ma ha un nome diverso (agenzia, genitore, numero di famiglia)
 * non viene unito. Si lega se: stessa email reale, oppure stesso nome (senza conflitti di paese/email), oppure stesso telefono con nome compatibile.
 */
export function refineGroups(groups: Guest[][]): Guest[][] {
  const out: Guest[][] = [];
  for (const group of groups) {
    const parent = new Map<string, string>(group.map((g) => [g.id, g.id]));
    const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
    const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      const ea = realEmail(a.email), eb = realEmail(b.email);
      const pa = normPhone(a.phone), pb = normPhone(b.phone);
      const link = (!!ea && ea === eb)
        || (sameName(a, b) && !conflicting(a, b))
        || (!!pa && pa === pb && nameCompatible(a, b) && !conflicting(a, b));
      if (link) union(a.id, b.id);
    }
    const sub = new Map<string, Guest[]>();
    for (const g of group) { const r = find(g.id); const arr = sub.get(r); if (arr) arr.push(g); else sub.set(r, [g]); }
    for (const arr of sub.values()) if (arr.length > 1) out.push(arr);
  }
  return out;
}

const SKIP = new Set(["id", "updatedAt", "tags", "vip", "marketingConsent", "notes", "preferences"]);

/** Cosa aggiungere alla scheda che resta: ogni campo mancante preso dalle altre, tag in unione, vip e consenso marketing in OR, note e preferenze accodate (senza ripetizioni). */
export function mergePatch(keeper: Guest, others: Guest[]): Partial<Guest> {
  const patch: Record<string, unknown> = {};
  const k = keeper as unknown as Record<string, unknown>;
  for (const g of others) {
    for (const [key, val] of Object.entries(g as unknown as Record<string, unknown>)) {
      if (SKIP.has(key) || empty(val)) continue;
      if (empty(k[key]) && empty(patch[key])) patch[key] = val;
    }
  }
  const tags = [...new Set([...(keeper.tags ?? []), ...others.flatMap((g) => g.tags ?? [])])];
  if (tags.length > (keeper.tags ?? []).length) patch.tags = tags;
  if (!keeper.vip && others.some((g) => g.vip)) patch.vip = true;
  if (!keeper.marketingConsent && others.some((g) => g.marketingConsent)) patch.marketingConsent = true;
  for (const key of ["notes", "preferences"] as const) {
    const parts: string[] = [];
    for (const t of [keeper[key], ...others.map((g) => g[key])]) { const v = (t ?? "").trim(); if (v && !parts.includes(v)) parts.push(v); }
    const joined = parts.join("\n");
    if (parts.length > 1 || (parts.length === 1 && empty(keeper[key]))) patch[key] = joined;
  }
  return patch as Partial<Guest>;
}

export interface MergePlan { keepId: string; dropIds: string[]; patch: Partial<Guest>; keeper: Guest; dropped: Guest[] }

/** Una proposta di unione per gruppo: resta la scheda con più prenotazioni (a parità, la prima). */
export function planMerges(groups: Guest[][], bookingCount: Map<string, number>): MergePlan[] {
  return groups.map((group) => {
    const keeper = [...group].sort((x, y) => (bookingCount.get(y.id) ?? 0) - (bookingCount.get(x.id) ?? 0))[0];
    const dropped = group.filter((g) => g.id !== keeper.id);
    return { keepId: keeper.id, dropIds: dropped.map((g) => g.id), patch: mergePatch(keeper, dropped), keeper, dropped };
  });
}
