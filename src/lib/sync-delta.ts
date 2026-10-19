// FASE 2 · scrittura a DELTA. Un browser con la sincronizzazione «a finestra» non può rimandare al server un blocco dati parziale (sembrerebbe che tutto il resto
// sia stato cancellato). Invia invece solo le MODIFICHE: quali entità sono nuove/cambiate, quali sono state cancellate (esplicitamente, mai dedotto
// dall'assenza), quali lapidi e quali campi/chiavi sono cambiati. Il server le applica all'archivio COMPLETO, con il lucchetto di versione.
//
// buildDelta (browser): confronta ciò che il server ci ha dato (finestra), l'ultima versione sincronizzata (base) e il risultato della fusione.
// applyDelta (server): applica le modifiche alla riga completa, con protezione contro le cancellazioni di massa.

type Json = Record<string, unknown>;

export const DATA_KEY = "spigolestay:data:v1";
// Collezioni di entità con id (stesso elenco di authsync.tsx ENTITY_COLLECTIONS).
export const ENTITY_COLLECTIONS = ["structures", "roomTypes", "units", "bookings", "guests", "directReviews", "events"] as const;
const COLL_SET = new Set<string>(ENTITY_COLLECTIONS);
const MAX_TOMBS = 3000;                     // come authsync.tsx
const MAX_ACTIVITIES = 500;                 // come authsync.tsx (registro attività)
const UNION_ARRAY_FIELDS = new Set(["_deletedLeads"]);       // array di valori semplici: unione
const UNION_BY_ID_FIELDS = new Set(["activities"]);          // array di oggetti con id: unione per id (immutabili)

// Cancellazioni di massa: oltre queste soglie il server rifiuta la richiesta (serve conferma esplicita).
export const MAX_DEL_BOOKINGS = 40;
export const MAX_DEL_OTHER = 25;

export interface CollDelta { upsert: Json[]; del: string[] }
export interface Delta {
  colls: Record<string, CollDelta>;
  tombs: Record<string, string[]>;          // lapidi da aggiungere per collezione
  fields: Record<string, unknown>;          // altri campi del blocco dati (rateOverrides, activities, …)
  flat: Record<string, string>;             // altre chiavi della riga (impostazioni, conversazioni…): valore intero
  confirm?: boolean;                        // consenso esplicito a cancellazioni oltre soglia
}
/** Riassunto leggibile di un delta (per i log: quante voci per tipo, SENZA dati personali). */
export function describeDelta(d: Delta): string {
  const parts: string[] = [];
  for (const [c, v] of Object.entries(d.colls)) if (v.upsert.length || v.del.length) parts.push(`${c}:+${v.upsert.length}/-${v.del.length}`);
  for (const [c, v] of Object.entries(d.tombs)) if (v.length) parts.push(`lapidi.${c}:${v.length}`);
  if (Object.keys(d.fields).length) parts.push("campi:" + Object.keys(d.fields).join(","));
  if (Object.keys(d.flat).length) parts.push("chiavi:" + Object.keys(d.flat).join(","));
  return parts.join(" ") || "vuoto";
}
export const emptyDelta = (): Delta => ({ colls: {}, tombs: {}, fields: {}, flat: {} });

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}
const isEmptyLike = (v: unknown): boolean => v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v as object).length === 0);
const same = (a: unknown, b: unknown): boolean => a === b || (isEmptyLike(a) && isEmptyLike(b)) || stableStringify(a) === stableStringify(b); // «assente» e «vuoto» sono la stessa cosa

// Chiavi piatte: stesso contenuto anche se scritto in modo diverso (ordine delle chiavi, spazi) = uguale. Senza, ogni ciclo rimanderebbe valori identici.
function sameFlat(server: string | undefined, merged: string): boolean {
  if (server === merged) return true;
  if (server === undefined) return false;
  try { return stableStringify(JSON.parse(server)) === stableStringify(JSON.parse(merged)); } catch { return false; }
}

const asObj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const asArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const idOf = (it: unknown): string | null => {
  const id = it && typeof it === "object" ? (it as { id?: unknown }).id : undefined;
  return id !== undefined && id !== null && id !== "" ? String(id) : null;
};
const byId = (list: unknown[]): Map<string, unknown> => { const m = new Map<string, unknown>(); for (const it of list) { const id = idOf(it); if (id) m.set(id, it); } return m; };

function parseObj(raw: string | undefined): Json | null {
  if (!raw) return null;
  try { const p = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? (p as Json) : null; } catch { return null; }
}

/** True se il delta non contiene alcuna modifica. */
export function isEmptyDelta(d: Delta): boolean {
  return !Object.values(d.colls).some((c) => c.upsert.length || c.del.length) && !Object.values(d.tombs).some((t) => t.length) && !Object.keys(d.fields).length && !Object.keys(d.flat).length;
}

/**
 * BROWSER. `server` = la riga come l'ha data il server (finestra); `base` = ultima versione sincronizzata (finestra, già fusa); `merged` = risultato della fusione.
 * Un'entità si invia solo se è cambiata rispetto a ENTRAMBE: così quelle uscite dalla finestra ma ancora in locale non vengono rimandate a ogni ciclo.
 * Una cancellazione si invia solo per ciò che il server ci ha DATO e che nel fuso non c'è più.
 */
export function buildDelta(server: Record<string, string> | null, base: Record<string, string> | null, merged: Record<string, string>): Delta {
  const delta = emptyDelta();
  const sData = parseObj(server?.[DATA_KEY]) ?? {};
  const bData = parseObj(base?.[DATA_KEY]) ?? {};
  const mData = parseObj(merged[DATA_KEY]);
  if (mData) {
    for (const coll of ENTITY_COLLECTIONS) {
      const sMap = byId(asArr(sData[coll])), bMap = byId(asArr(bData[coll])), mList = asArr(mData[coll]), mMap = byId(mList);
      const upsert: Json[] = [], del: string[] = [];
      for (const it of mList) {
        const id = idOf(it); if (!id) continue;
        const s = sMap.get(id), b = bMap.get(id);
        if ((s === undefined || !same(s, it)) && (b === undefined || !same(b, it))) upsert.push(it as Json);
      }
      for (const id of sMap.keys()) if (!mMap.has(id)) del.push(id);
      if (upsert.length || del.length) delta.colls[coll] = { upsert, del };
    }
    // lapidi: quelle del fuso che il server non ha ancora
    const sTomb = asObj(sData._deleted), mTomb = asObj(mData._deleted);
    for (const coll of Object.keys(mTomb)) {
      const have = new Set(asArr(sTomb[coll]).map(String));
      const add = asArr(mTomb[coll]).map(String).filter((id) => !have.has(id));
      if (add.length) delta.tombs[coll] = add;
    }
    // altri campi del blocco dati (non finestrati: confronto diretto col server)
    for (const k of Object.keys(mData)) {
      if (COLL_SET.has(k) || k === "_deleted") continue;
      if (!same(mData[k], sData[k])) delta.fields[k] = mData[k];
    }
  }
  // chiavi piatte: valore intero se diverso dal server (mai cancellate da un delta)
  for (const k of Object.keys(merged)) {
    if (k === DATA_KEY) continue;
    const v = merged[k];
    if (typeof v !== "string") continue;
    if (!sameFlat(server?.[k], v)) delta.flat[k] = v;
  }
  return delta;
}

export class DeltaError extends Error {
  code: "mass_delete" | "bad_data";
  constructor(code: "mass_delete" | "bad_data", message: string) { super(message); this.code = code; }
}

/**
 * SERVER. Applica `delta` a una riga COMPLETA (`row`) e ritorna la nuova riga. Non modifica l'originale.
 * Protezioni: senza `confirm`, più di MAX_DEL_BOOKINGS prenotazioni (o MAX_DEL_OTHER altre entità) cancellate in una volta = rifiutato.
 */
export function applyDelta(row: Record<string, string> | null, delta: Delta): { row: Record<string, string>; stats: { upserts: number; deletes: number; tombs: number } } {
  const out: Record<string, string> = { ...(row ?? {}) };
  let d: Json;
  if (out[DATA_KEY]) {
    const p = parseObj(out[DATA_KEY]);
    if (!p) throw new DeltaError("bad_data", "il blocco dati sul server non è leggibile: non si applica nulla");
    d = p;
  } else d = {};

  // soglie sulle cancellazioni
  // (una cancellazione conta una volta, sia che arrivi come «del» sia come lapide)
  let delBookings = 0, delOther = 0;
  for (const coll of new Set([...Object.keys(delta.colls), ...Object.keys(delta.tombs)])) {
    const n = new Set([...(delta.colls[coll]?.del ?? []), ...(delta.tombs[coll] ?? [])].map(String)).size;
    if (coll === "bookings") delBookings += n; else if (COLL_SET.has(coll)) delOther += n;
  }
  if (!delta.confirm && (delBookings > MAX_DEL_BOOKINGS || delOther > MAX_DEL_OTHER)) {
    throw new DeltaError("mass_delete", `cancellazione di massa rifiutata (${delBookings} prenotazioni, ${delOther} altre voci): serve conferma esplicita`);
  }

  let upserts = 0, deletes = 0, tombCount = 0;
  for (const [coll, c] of Object.entries(delta.colls)) {
    if (!COLL_SET.has(coll)) continue;
    let list = asArr(d[coll]).slice();
    if (c.del.length) {
      const del = new Set(c.del);
      const before = list.length;
      list = list.filter((it) => { const id = idOf(it); return !(id && del.has(id)); });
      deletes += before - list.length;
    }
    if (c.upsert.length) {
      const idx = new Map<string, number>();
      list.forEach((it, i) => { const id = idOf(it); if (id) idx.set(id, i); });
      for (const it of c.upsert) {
        const id = idOf(it); if (!id) continue;
        const at = idx.get(id);
        if (at !== undefined) list[at] = it; else { idx.set(id, list.length); list.push(it); }
        upserts++;
      }
    }
    d[coll] = list;
  }

  if (Object.keys(delta.tombs).length) {
    const tomb = asObj(d._deleted);
    for (const [coll, ids] of Object.entries(delta.tombs)) {
      const cur = asArr(tomb[coll]).map(String);
      const set = new Set(cur);
      const add = ids.map(String).filter((id) => !set.has(id));
      tombCount += add.length;
      tomb[coll] = [...cur, ...add].slice(-MAX_TOMBS);
      // una lapide è una cancellazione: l'entità sparisce anche dall'archivio completo (anche se era fuori dalla finestra del browser)
      if (add.length && COLL_SET.has(coll)) {
        const gone = new Set(add);
        const before = asArr(d[coll]);
        const kept = before.filter((it) => { const id = idOf(it); return !(id && gone.has(id)); });
        if (kept.length !== before.length) { deletes += before.length - kept.length; d[coll] = kept; }
      }
    }
    d._deleted = tomb;
  }

  for (const [k, v] of Object.entries(delta.fields)) {
    if (COLL_SET.has(k) || k === "_deleted") continue;
    if (UNION_ARRAY_FIELDS.has(k)) {
      const set = new Set<string>(); const res: unknown[] = [];
      for (const it of [...asArr(d[k]), ...asArr(v)]) { const key = typeof it === "string" ? it : stableStringify(it); if (!set.has(key)) { set.add(key); res.push(it); } }
      d[k] = res;
    } else if (UNION_BY_ID_FIELDS.has(k)) {
      const m = new Map<string, unknown>();
      for (const it of [...asArr(d[k]), ...asArr(v)]) { const id = idOf(it); m.set(id ?? "#" + stableStringify(it), it); }
      const ts = (it: unknown) => { const t = (it as { ts?: unknown })?.ts; return typeof t === "number" && isFinite(t) ? t : 0; };
      d[k] = [...m.values()].sort((a, b) => ts(b) - ts(a)).slice(0, MAX_ACTIVITIES);
    } else d[k] = v;
  }

  if (out[DATA_KEY] || Object.keys(d).length) out[DATA_KEY] = JSON.stringify(d);
  for (const [k, v] of Object.entries(delta.flat)) if (k !== DATA_KEY && typeof v === "string") out[k] = v;
  return { row: out, stats: { upserts, deletes, tombs: tombCount } };
}
