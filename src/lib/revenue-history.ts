// Revenue — storico delle modifiche di tariffa APPLICATE (Autopilot, Revenue, Nèttare) con "Annulla".
//
// Ogni applicazione registra, per ogni tariffa toccata, il valore che c'era PRIMA (l'override del
// calendario precedente, oppure "nessuno" = tariffa di listino) e quello scritto. L'annullamento
// ripristina il valore precedente SOLO per le tariffe che non sono state ritoccate dopo (se oggi
// l'override è diverso da quello che avevamo scritto, qualcuno l'ha cambiato a mano: non lo
// sovrascriviamo). Il batch è sempre di UNA struttura, così "Annulla" non tocca mai le altre.
//
// Lo storico vive nel browser (localStorage) di questo dispositivo: non è sul server.
export type RevenueSource = "autopilot-manuale" | "autopilot-auto" | "revenue" | "nettare";
export const SOURCE_LABEL: Record<RevenueSource, string> = {
  "autopilot-manuale": "Autopilot (applicato da te)",
  "autopilot-auto": "Autopilot (automatico)",
  revenue: "Revenue",
  nettare: "Nèttare",
};

export interface PriceChange {
  key: string;           // chiave override del calendario: `${typeId}|${iso}`
  typeName: string;
  iso: string;
  structureId: string;
  before: number | null; // override presente prima (null = nessuno, valeva il listino)
  effBefore: number;     // tariffa effettiva prima (per mostrare la variazione)
  after: number;         // tariffa scritta
}

export interface PriceBatch {
  id: string;
  ts: number;
  source: RevenueSource;
  structureId: string;
  label: string;
  changes: PriceChange[];
  undoneAt?: number;
}

const KEY = "spigolestay:revenue-history";
const MAX_BATCHES = 40;
const MAX_CHANGES = 1500;
const EVT = "xenora:revenue-history";

const uid = () => `rh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function read(): PriceBatch[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const r = localStorage.getItem(KEY);
    if (!r) return [];
    const v = JSON.parse(r);
    return Array.isArray(v) ? (v as PriceBatch[]).filter((b) => b && Array.isArray(b.changes)) : [];
  } catch { return []; }
}
function write(list: PriceBatch[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_BATCHES)));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
    return true;
  } catch { return false; }
}

/** Storico per struttura ("all" = tutte), dal più recente. */
export function loadHistory(structureId: string): PriceBatch[] {
  const all = read();
  return !structureId || structureId === "all" ? all : all.filter((b) => b.structureId === structureId);
}

/** Si abbona ai cambiamenti dello storico (stessa scheda e altre schede). Ritorna la funzione di disiscrizione. */
export function subscribeHistory(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVT, cb); window.removeEventListener("storage", onStorage); };
}

export interface ChangeDraft { key: string; typeName: string; iso: string; structureId: string; effBefore: number; after: number }

/** Costruisce le modifiche leggendo il valore precedente dagli override correnti. Scarta le non-variazioni. */
export function buildChanges(drafts: ChangeDraft[], rateOverrides: Record<string, number>): PriceChange[] {
  const out: PriceChange[] = [];
  for (const d of drafts) {
    const before = Object.prototype.hasOwnProperty.call(rateOverrides, d.key) ? rateOverrides[d.key] : null;
    if (before === d.after) continue;
    out.push({ key: d.key, typeName: d.typeName, iso: d.iso, structureId: d.structureId, before, effBefore: d.effBefore, after: d.after });
  }
  return out;
}

/** Registra l'applicazione. Una voce per struttura (le modifiche sono raggruppate per structureId). */
export function recordBatches(source: RevenueSource, label: string, changes: PriceChange[]): PriceBatch[] {
  if (!changes.length) return [];
  const bySid = new Map<string, PriceChange[]>();
  for (const c of changes) { const a = bySid.get(c.structureId) ?? []; a.push(c); bySid.set(c.structureId, a); }
  const now = Date.now();
  const made: PriceBatch[] = [...bySid.entries()].map(([sid, list]) => ({ id: uid(), ts: now, source, structureId: sid, label, changes: list.slice(0, MAX_CHANGES) }));
  write([...made, ...read()]);
  return made;
}

export interface UndoPlan {
  restore: Record<string, number>; // tariffe da rimettare al valore di prima
  clear: string[];                 // override da rimuovere (prima non c'era: torna il listino)
  skipped: number;                 // tariffe ritoccate dopo l'applicazione (non toccate)
}

/** Piano di annullamento, sicuro: agisce solo dove l'override attuale è ancora quello scritto dall'applicazione. */
export function planUndo(batch: PriceBatch, rateOverrides: Record<string, number>): UndoPlan {
  const plan: UndoPlan = { restore: {}, clear: [], skipped: 0 };
  for (const c of batch.changes) {
    const cur = Object.prototype.hasOwnProperty.call(rateOverrides, c.key) ? rateOverrides[c.key] : undefined;
    if (cur !== c.after) { plan.skipped++; continue; }
    if (c.before == null) plan.clear.push(c.key); else plan.restore[c.key] = c.before;
  }
  return plan;
}

export function markUndone(id: string): void {
  write(read().map((b) => (b.id === id ? { ...b, undoneAt: Date.now() } : b)));
}
