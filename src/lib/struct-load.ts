// Stato (nel browser) di quali STRUTTURE sono state caricate in questa sessione, in «modalità veloce». La lettura a finestra scarica le prenotazioni/ospiti/eventi/prezzi
// forzati delle sole strutture richieste; strutture, tipologie e camere di tutte arrivano sempre. Le altre si caricano quando servono (cambio struttura, «Tutte»,
// operazioni che le toccano) e restano caricate fino alla chiusura della sessione. Fuori dalla modalità veloce (`active` falso) è tutto trasparente: ogni struttura risulta caricata.
//
// Un dato NON caricato non è un dato cancellato: la scrittura a delta non lo invia mai (vedi buildDelta, parametro scope) e il server non lo tocca.
import { useSyncExternalStore } from "react";

type Req = Set<string> | "all";

let active = false;                  // modalità veloce attiva in questa sessione
let requested: Req = new Set();      // cosa chiediamo al server a ogni lettura
let loaded: Req = new Set();         // cosa è già arrivato (un ciclo di sincronizzazione completo con quella richiesta)
let version = 0;
let error = "";
let loadingNames: string[] = [];
const codeMax = new Map<string, Record<string, number>>(); // per riga (tabella:id) → massimo progressivo dei codici XEN-AAAA-n sull'archivio completo

export interface StructLoadSnapshot { version: number; active: boolean; loading: string[]; error: string; partial: boolean }
let snap: StructLoadSnapshot = { version: 0, active: false, loading: [], error: "", partial: false };
const listeners = new Set<() => void>();
function emit(): void {
  version++;
  snap = { version, active, loading: loadingNames, error, partial: active && loaded !== "all" };
  listeners.forEach((l) => { try { l(); } catch { /* ascoltatore difettoso */ } });
}

export function setDeltaScopeActive(on: boolean): void { active = on; if (!on) { requested = new Set(); loaded = new Set(); error = ""; loadingNames = []; } emit(); }
export function isScopeActive(): boolean { return active; }

/** Richiesta iniziale (all'avvio). null = nessuna indicazione (si scaricano solo strutture/camere: poi si completa). */
export function initRequested(v: string[] | "all" | null): void {
  requested = v === "all" ? "all" : new Set(v ?? []);
  loaded = new Set();
  emit();
}
/** Parametro `structureIds` da mettere nella lettura a finestra: null = nessun filtro (tutte). */
export function requestedParam(): string | null {
  if (!active || requested === "all") return null;
  return requested.size ? [...requested].join(",") : "none";
}
/** Strutture per cui il server ci dà i dati (scope di buildDelta): null = tutte. */
export function requestedIds(): string[] | null {
  if (!active || requested === "all") return null;
  return [...requested];
}
export function requestedSnapshot(): Req { return requested === "all" ? "all" : new Set(requested); }
export function addRequested(ids: string[], all = false): void {
  if (all) requested = "all";
  else if (requested !== "all") { const n = new Set(requested); ids.forEach((i) => n.add(i)); requested = n; }
  emit();
}
/** Un ciclo di sincronizzazione completo, fatto con la richiesta `req`, è arrivato in fondo: quelle strutture sono caricate. */
export function markLoaded(req: Req): void {
  if (req === "all") loaded = "all";
  else if (loaded !== "all") { const n = new Set(loaded); req.forEach((i) => n.add(i)); loaded = n; }
  emit();
}
/** Struttura creata qui (o importata per intero): è per definizione completa nel locale. */
export function addLocalStructure(id: string): void {
  if (!active) return;
  if (requested !== "all") { const n = new Set(requested); n.add(id); requested = n; }
  if (loaded !== "all") { const n = new Set(loaded); n.add(id); loaded = n; }
  emit();
}
export function structureLoaded(id: string | undefined | null): boolean {
  if (!active || loaded === "all") return true;
  return !!id && loaded.has(id);
}
export function loadedSet(): Set<string> | null { return !active || loaded === "all" ? null : new Set(loaded); } // null = tutte
export function allLoaded(allIds: string[]): boolean { return !active || loaded === "all" || allIds.every((i) => (loaded as Set<string>).has(i)); }

export function noteCodeMax(rowKey: string, m: Record<string, number> | undefined | null): void { if (m && typeof m === "object") codeMax.set(rowKey, m); }
/** Massimo progressivo già usato per l'anno `year` su TUTTE le righe lette (anche per strutture non caricate). */
export function codeMaxFor(year: string): number { let mx = 0; for (const m of codeMax.values()) { const n = m?.[year]; if (typeof n === "number" && n > mx) mx = n; } return mx; }

export function clearLoadError(): void { if (error) { error = ""; emit(); } }

type Loader = (need: string[], all: boolean) => Promise<boolean>;
let loader: Loader | null = null;
export function registerLoader(fn: Loader | null): void { loader = fn; }

const inflight = new Map<string, Promise<boolean>>();
/**
 * Fa in modo che le strutture `ids` siano caricate. true = pronte (o non serve caricare); false = non riuscito (rete…): la vista corrente resta, `error` spiega.
 * `all` = «Tutte le strutture»: da ora si chiede tutto senza filtro. `label` = nome da mostrare ("Carico …").
 */
export function ensureLoaded(ids: string[], label: string, all = false): Promise<boolean> {
  if (!active) return Promise.resolve(true);
  const need = ids.filter((i) => !structureLoaded(i));
  if (!need.length) return Promise.resolve(true);
  if (!loader) return Promise.resolve(false);
  const key = (all ? "*" : "") + need.slice().sort().join(",");
  const cur = inflight.get(key); if (cur) return cur;
  loadingNames = [...loadingNames, label]; error = ""; emit();
  const p = (async () => {
    let ok = false;
    try { ok = await loader!(need, all); } catch { ok = false; }
    const li = loadingNames.indexOf(label); if (li >= 0) loadingNames = loadingNames.filter((_, j) => j !== li);
    error = ok ? "" : `Non riesco a caricare ${label}: controlla la connessione. Resti sulla vista di prima, i dati sono al sicuro sul server.`;
    inflight.delete(key);
    emit();
    return ok;
  })();
  inflight.set(key, p);
  return p;
}

export function getStructLoadSnapshot(): StructLoadSnapshot { return snap; }
export function subscribeStructLoad(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function useStructLoad(): StructLoadSnapshot { return useSyncExternalStore(subscribeStructLoad, getStructLoadSnapshot, getStructLoadSnapshot); }

/** Solo per i test: riporta tutto allo stato iniziale. */
export function __resetStructLoad(): void { active = false; requested = new Set(); loaded = new Set(); error = ""; loadingNames = []; codeMax.clear(); inflight.clear(); loader = null; emit(); }
