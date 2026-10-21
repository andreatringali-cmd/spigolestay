// FASE 2 · scrittura a DELTA. Un browser con la sincronizzazione «a finestra» non può rimandare al server un blocco dati parziale (sembrerebbe che tutto il resto
// sia stato cancellato). Invia invece solo le MODIFICHE: quali entità sono nuove/cambiate, quali sono state cancellate (esplicitamente, mai dedotto
// dall'assenza), quali lapidi e quali campi/chiavi sono cambiati. Il server le applica all'archivio COMPLETO, con il lucchetto di versione.
//
// buildDelta (browser): confronta ciò che il server ci ha dato (finestra), l'ultima versione sincronizzata (base) e il risultato della fusione.
// applyDelta (server): applica le modifiche alla riga completa, con protezione contro le cancellazioni di massa.

import { sameFlatContent } from "./sync-canon";

type Json = Record<string, unknown>;

export const DATA_KEY = "spigolestay:data:v1";
// Collezioni di entità con id (stesso elenco di authsync.tsx ENTITY_COLLECTIONS).
export const ENTITY_COLLECTIONS = ["structures", "roomTypes", "units", "bookings", "guests", "directReviews", "events"] as const;
const COLL_SET = new Set<string>(ENTITY_COLLECTIONS);
const MAX_TOMBS = 20000;                    // tetto SUL SERVER. Il browser ne tiene al massimo 3000 (authsync/sync-core): se il server tagliasse alle stesse 3000 le due liste ruoterebbero all'infinito
const MAX_ACTIVITIES = 500;                 // come authsync.tsx (registro attività)
const UNION_ARRAY_FIELDS = new Set(["_deletedLeads"]);       // array di valori semplici: unione
const UNION_BY_ID_FIELDS = new Set(["activities"]);          // array di oggetti con id: unione per id (immutabili)

// Cancellazioni di massa: oltre queste soglie il server rifiuta la richiesta (serve conferma esplicita).
export const MAX_DEL_BOOKINGS = 40;
export const MAX_DEL_OTHER = 25;

export interface CollDelta { upsert: Json[]; del: string[] }
export interface Delta {
  colls: Record<string, CollDelta>;
  tombs: Record<string, string[]>;          // lapidi NUOVE da aggiungere per collezione (il server le unisce a quelle che ha)
  fields: Record<string, unknown>;          // altri campi del blocco dati (rateOverrides, activities, …)
  rates?: { set: Record<string, unknown>; del: string[] }; // prezzi forzati (rateOverrides) PER CHIAVE: il server ne vede solo una parte (strutture richieste), quindi mai sostituire la mappa intera
  flat: Record<string, string>;             // altre chiavi della riga (impostazioni, conversazioni…): valore intero
  confirm?: boolean;                        // consenso esplicito a cancellazioni oltre soglia
  v?: number;                               // versione del formato (informativa)
  diag?: Record<string, number>;            // diagnostica: perché le entità sono state inviate (solo conteggi)
}
/** Riassunto leggibile di un delta (per i log: quante voci per tipo, SENZA dati personali). */
export function describeDelta(d: Delta): string {
  const parts: string[] = [];
  if (d.diag) parts.push("perché:" + Object.entries(d.diag).map(([k, n]) => k + "=" + n).join(","));
  for (const [c, v] of Object.entries(d.colls)) if (v.upsert.length || v.del.length) parts.push(`${c}:+${v.upsert.length}/-${v.del.length}`);
  for (const [c, v] of Object.entries(d.tombs)) if (v.length) parts.push(`lapidi.${c}:${v.length}`);
  if (d.rates && (Object.keys(d.rates.set).length || d.rates.del.length)) parts.push(`prezzi:+${Object.keys(d.rates.set).length}/-${d.rates.del.length}`);
  if (Object.keys(d.fields).length) parts.push("campi:" + Object.keys(d.fields).join(","));
  if (Object.keys(d.flat).length) parts.push("chiavi:" + Object.keys(d.flat).join(","));
  return parts.join(" ") || "vuoto";
}
export const DELTA_VERSION = 2;
/** Diagnostica: per ogni collezione, QUALI CAMPI cambiano nelle entità inviate rispetto a quelle sul server (solo nomi di campo e conteggi, mai valori). */
export function describeFieldChanges(row: Record<string, string> | null, delta: Delta): string {
  const d = parseObj(row?.[DATA_KEY]) ?? {};
  const out: string[] = [];
  for (const [coll, c] of Object.entries(delta.colls)) {
    if (!c.upsert.length) continue;
    const m = byId(asArr(d[coll]));
    const hist = new Map<string, number>(); let isNew = 0;
    for (const it of c.upsert) {
      const id = idOf(it); const old = id ? m.get(id) as Json | undefined : undefined;
      if (!old) { isNew++; continue; }
      for (const k of new Set([...Object.keys(it), ...Object.keys(old)])) if (!same((it as Json)[k], old[k])) hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    out.push(`${coll}[nuove:${isNew} ${[...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => k + "=" + n).join(",")}]`);
  }
  return out.join(" ");
}
export const emptyDelta = (): Delta => ({ colls: {}, tombs: {}, fields: {}, flat: {}, v: DELTA_VERSION });

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}
const isEmptyLike = (v: unknown): boolean => v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v as object).length === 0);
const same = (a: unknown, b: unknown): boolean => a === b || (isEmptyLike(a) && isEmptyLike(b)) || stableStringify(a) === stableStringify(b); // «assente» e «vuoto» sono la stessa cosa

// Chiavi piatte: stesso contenuto anche se scritto in modo diverso (ordine delle chiavi, spazi) = uguale. Senza, ogni ciclo rimanderebbe valori identici.
// Anche l'ordine di una lista di oggetti con id (o dei conti di Cassa, per chiave) non conta: vedi sync-canon.ts.
function sameFlat(key: string, server: string | undefined, merged: string): boolean {
  return sameFlatContent(key, server, merged);
}

const asObj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const asArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const tsOf = (it: unknown): number => { const t = it && typeof it === "object" ? (it as { updatedAt?: unknown }).updatedAt : undefined; return typeof t === "number" && isFinite(t) ? t : 0; };
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
  return !Object.values(d.colls).some((c) => c.upsert.length || c.del.length) && !Object.values(d.tombs).some((t) => t.length) && !Object.keys(d.fields).length && !Object.keys(d.flat).length
    && !(d.rates && (Object.keys(d.rates.set).length || d.rates.del.length));
}

/** Cancellazione ESPLICITA di un ospite: lapide nel fuso, oppure contatto newsletter (sito / tag) il cui email/telefono e' tra i contatti cancellati (stessa regola di mergeSnapshots). */
function guestRemovalIsExplicit(id: string, serverGuest: unknown, mData: Json): boolean {
  if (asArr(asObj(mData._deleted).guests).some((x) => String(x) === id)) return true;
  const deleted = new Set(asArr(mData._deletedLeads).filter((x): x is string => typeof x === "string"));
  if (!deleted.size) return false;
  const g = asObj(serverGuest);
  const lead = g.source === "sito" || (Array.isArray(g.tags) && g.tags.includes("newsletter"));
  if (!lead) return false;
  const email = typeof g.email === "string" ? g.email.trim().toLowerCase() : "";
  const phone = typeof g.phone === "string" ? g.phone.replace(/[\s+()./-]/g, "") : "";
  return (!!email && deleted.has("email:" + email)) || (phone.length >= 6 && deleted.has("tel:" + phone));
}

/**
 * BROWSER. `server` = la riga come l'ha data il server (finestra); `base` = ultima versione sincronizzata (finestra, già fusa); `merged` = risultato della fusione.
 * Un'entità si invia solo se è cambiata rispetto a ENTRAMBE: così quelle uscite dalla finestra ma ancora in locale non vengono rimandate a ogni ciclo.
 * Una cancellazione si invia solo per ciò che il server ci ha DATO e che nel fuso non c'è più.
 * `scope` (apertura per struttura): elenco delle strutture di cui il server ci ha dato prenotazioni/eventi/recensioni/prezzi (null = tutte). Un'entità di una struttura
 * NON in elenco (rimasta in locale da una sessione precedente) non si invia mai: non l'abbiamo caricata, quindi non possiamo averla cambiata e la copia locale può essere stantia.
 */
export function buildDelta(server: Record<string, string> | null, base: Record<string, string> | null, merged: Record<string, string>, scope?: string[] | null): Delta {
  const delta = emptyDelta();
  const sData = parseObj(server?.[DATA_KEY]) ?? {};
  const bData = parseObj(base?.[DATA_KEY]) ?? {};
  const mData = parseObj(merged[DATA_KEY]);
  if (mData) {
    const scoped = Array.isArray(scope);
    const scopeSet = new Set<string>(scoped ? scope : []);
    const knownSids = new Set<string>(asArr(mData.structures).map((x) => idOf(x)).filter((x): x is string => !!x));
    const outOfScope = (sid: unknown): boolean => scoped && typeof sid === "string" && sid !== "" && knownSids.has(sid) && !scopeSet.has(sid);
    for (const coll of ENTITY_COLLECTIONS) {
      const sMap = byId(asArr(sData[coll])), bMap = byId(asArr(bData[coll])), mList = asArr(mData[coll]), mMap = byId(mList);
      const upsert: Json[] = [], del: string[] = [];
      const hasSid = coll === "bookings" || coll === "events" || coll === "directReviews";
      for (const it of mList) {
        const id = idOf(it); if (!id) continue;
        if (hasSid && outOfScope((it as Json).structureId)) continue; // struttura non caricata: mai inviata
        const s = sMap.get(id), b = bMap.get(id);
        if ((s === undefined || !same(s, it)) && (b === undefined || !same(b, it))) {
          upsert.push(it as Json);
          const dg = (delta.diag ??= {});
          const k = `${coll}:${s === undefined ? "fuoriFinestra" : "diversoDalServer"}/${b === undefined ? "nonInBase" : "diversoDallaBase"}`;
          dg[k] = (dg[k] ?? 0) + 1;
        }
      }
      for (const id of sMap.keys()) {
        if (mMap.has(id)) continue;
        // Un OSPITE assente dal fuso non e' per forza cancellato: gli ospiti dell'organizzazione sono una proiezione (quelli citati dalle prenotazioni caricate qui) e un ospite appena
        // creato puo' stare nella finestra senza la sua prenotazione. Si cancella dal server solo con una lapide (cancellazione dell'utente) o se e' un contatto newsletter da rimuovere.
        if (coll === "guests" && !guestRemovalIsExplicit(id, sMap.get(id), mData)) continue;
        del.push(id);
      }
      if (upsert.length || del.length) delta.colls[coll] = { upsert, del };
    }
    // lapidi: solo quelle del fuso che il server non ha ancora
    const sTomb = asObj(sData._deleted), mTomb = asObj(mData._deleted);
    for (const coll of Object.keys(mTomb)) {
      const have = new Set(asArr(sTomb[coll]).map(String));
      const add = asArr(mTomb[coll]).map(String).filter((id) => !have.has(id));
      if (add.length) delta.tombs[coll] = add;
    }
    // prezzi forzati: per CHIAVE (il server ci ha dato solo i prezzi delle strutture richieste: la mappa intera non va mai sostituita)
    {
      const sRo = asObj(sData.rateOverrides), bRo = asObj(bData.rateOverrides), mRo = asObj(mData.rateOverrides);
      const sidOfRt = new Map<string, string>();
      for (const rt of asArr(mData.roomTypes)) { const id = idOf(rt), sid = (rt as Json)?.structureId; if (id && typeof sid === "string") sidOfRt.set(id, sid); }
      const skipKey = (k: string): boolean => { const rtId = k.includes("|") ? k.split("|")[0] : ""; return !!rtId && outOfScope(sidOfRt.get(rtId)); };
      const set: Record<string, unknown> = {}, rdel: string[] = [];
      for (const k of Object.keys(mRo)) { if (skipKey(k)) continue; if (!same(mRo[k], sRo[k]) && !(k in bRo && same(mRo[k], bRo[k]))) set[k] = mRo[k]; }
      for (const k of Object.keys(sRo)) if (!(k in mRo)) rdel.push(k);
      if (Object.keys(set).length || rdel.length) delta.rates = { set, del: rdel };
    }
    // altri campi del blocco dati (non finestrati: confronto diretto col server)
    for (const k of Object.keys(mData)) {
      if (COLL_SET.has(k) || k === "_deleted" || k === "rateOverrides") continue;
      if (!same(mData[k], sData[k])) delta.fields[k] = mData[k];
    }
  }
  // chiavi piatte: valore intero se diverso dal server (mai cancellate da un delta)
  for (const k of Object.keys(merged)) {
    if (k === DATA_KEY) continue;
    const v = merged[k];
    if (typeof v !== "string") continue;
    if (!sameFlat(k, server?.[k], v)) delta.flat[k] = v;
  }
  return delta;
}

/**
 * Una cancellazione di massa è un SPOSTAMENTO (non una perdita) se ogni entità cancellata esiste ancora, con lo stesso id, in un'altra riga dello stesso utente
 * (es. le copie che il personale tiene delle strutture condivise: passano nell'organizzazione). Solo in quel caso il server può accettarla senza conferma.
 */
export function deletesAreMoves(delta: Delta, otherRows: Array<Record<string, string> | null | undefined>): boolean {
  const have: Record<string, Set<string>> = {};
  for (const row of otherRows) {
    const d = parseObj(row?.[DATA_KEY]); if (!d) continue;
    for (const coll of ENTITY_COLLECTIONS) { const set = (have[coll] ??= new Set<string>()); for (const it of asArr(d[coll])) { const id = idOf(it); if (id) set.add(id); } }
  }
  let any = false;
  for (const [coll, c] of Object.entries(delta.colls)) {
    for (const id of c.del) { any = true; if (!have[coll]?.has(String(id))) return false; }
  }
  return any && Object.values(delta.tombs).every((t) => t.length === 0); // lapidi nuove = vere cancellazioni: mai considerate spostamenti
}

export class DeltaError extends Error {
  code: "mass_delete" | "bad_data";
  constructor(code: "mass_delete" | "bad_data", message: string) { super(message); this.code = code; }
}

/**
 * SERVER. Applica `delta` a una riga COMPLETA (`row`) e ritorna la nuova riga. Non modifica l'originale.
 * Protezioni: senza `confirm`, più di MAX_DEL_BOOKINGS prenotazioni (o MAX_DEL_OTHER altre entità) cancellate in una volta = rifiutato.
 */
export function applyDelta(row: Record<string, string> | null, delta: Delta): { row: Record<string, string>; stats: { upserts: number; deletes: number; tombs: number; changed: boolean } } {
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
  const curTombs = asObj(d._deleted);
  const newTombs = (coll: string): string[] => { const have = new Set(asArr(curTombs[coll]).map(String)); return (delta.tombs[coll] ?? []).map(String).filter((id) => !have.has(id)); };
  for (const coll of new Set([...Object.keys(delta.colls), ...Object.keys(delta.tombs)])) {
    const n = new Set([...(delta.colls[coll]?.del ?? []), ...newTombs(coll)].map(String)).size;
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
        // Mai sovrascrivere una versione PIÙ RECENTE presente sul server (stessa regola «vince l'ultima modifica» della fusione nel browser):
        // un'entità stantia rimasta in un dispositivo non può far tornare indietro un'altra modificata altrove nel frattempo.
        if (at !== undefined && tsOf(list[at]) > tsOf(it)) continue;
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

  // prezzi forzati: aggiunte/modifiche e rimozioni per CHIAVE sulla mappa completa del server (le chiavi non citate restano)
  if (delta.rates && (Object.keys(delta.rates.set ?? {}).length || (delta.rates.del ?? []).length)) {
    const ro: Json = { ...asObj(d.rateOverrides) };
    for (const [k, v] of Object.entries(delta.rates.set ?? {})) ro[k] = v;
    for (const k of delta.rates.del ?? []) delete ro[k];
    d.rateOverrides = ro;
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

  // Nessuna modifica reale (es. entità inviate identiche a quelle già sul server): il chiamante non deve scrivere né far salire la versione.
  let changed = !same(parseObj(row?.[DATA_KEY]) ?? {}, d);
  if (out[DATA_KEY] || Object.keys(d).length) out[DATA_KEY] = JSON.stringify(d);
  for (const [k, v] of Object.entries(delta.flat)) if (k !== DATA_KEY && typeof v === "string") { if (!sameFlat(k, row?.[k], v)) changed = true; out[k] = v; }
  return { row: out, stats: { upserts, deletes, tombs: tombCount, changed } };
}
