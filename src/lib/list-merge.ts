// Fusione a 3 vie di una LISTA salvata per intero in una chiave sincronizzata (es. categorie e conti della Cassa), con le voci identificate da `key`.
// Prima vinceva sempre la copia locale in blocco: un dispositivo o una scheda con la lista vecchia faceva sparire le voci create altrove.
// Regole (local = questo browser, server = ultima copia sul server, base = ultima copia sincronizzata):
//  - voce solo sul server: se era già nella base l'utente l'ha cancellata qui (resta cancellata), altrimenti l'ha creata un altro dispositivo (si tiene);
//  - voce in entrambe: vince il locale, salvo che il locale sia ancora identico alla base e il server l'abbia modificata (allora si adotta il server);
//  - voce solo nel locale: si tiene (creata qui).
// Ritorna null se uno dei testi non è una lista JSON valida (si lascia la regola di prima).
type Entry = Record<string, unknown> & { key?: unknown };

const parse = (raw: string | undefined): Entry[] | null => {
  if (raw === undefined) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? (v as Entry[]) : null; } catch { return null; }
};
const keyOf = (e: Entry): string | null => (e && typeof e === "object" && typeof e.key === "string" ? e.key : null);

export function mergeKeyedList(localRaw: string | undefined, serverRaw: string | undefined, baseRaw: string | undefined): string | null {
  const local = parse(localRaw);
  const server = parse(serverRaw);
  if (!local || !server) return null;
  const base = parse(baseRaw) ?? [];
  const baseBy = new Map<string, Entry>();
  for (const e of base) { const k = keyOf(e); if (k) baseBy.set(k, e); }
  const serverBy = new Map<string, Entry>();
  for (const e of server) { const k = keyOf(e); if (k) serverBy.set(k, e); }
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const e of local) {
    const k = keyOf(e);
    if (!k) { out.push(e); continue; }
    seen.add(k);
    const s = serverBy.get(k), b = baseBy.get(k);
    const localUnchanged = b !== undefined && JSON.stringify(e) === JSON.stringify(b);
    out.push(s !== undefined && localUnchanged && JSON.stringify(s) !== JSON.stringify(b) ? s : e);
  }
  for (const e of server) {
    const k = keyOf(e);
    if (!k || seen.has(k)) continue;
    if (baseBy.has(k)) continue; // cancellata da questo browser
    out.push(e);
  }
  return JSON.stringify(out);
}
