// D4: la guardia di scrittura del blocco grande vale anche per le scritture GIÀ in coda (write-behind) quando vengono scaricate su IndexedDB.
// Prova vera con un IndexedDB finto condiviso (come tra due schede): la scheda A mette in coda una scrittura, poi un'altra scheda cambia account e scrive i SUOI dati;
// allo scarico della coda la scheda A non deve sovrascriverli.
import test from "node:test";
import assert from "node:assert/strict";

const ls = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = {
  get length() { return ls.size; }, key: (i: number) => [...ls.keys()][i] ?? null,
  getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null), setItem: (k: string, v: string) => { ls.set(k, String(v)); },
  removeItem: (k: string) => { ls.delete(k); }, clear: () => ls.clear(),
} as Storage;
g.window = { addEventListener() {}, dispatchEvent() { return true; } };
g.document = { addEventListener() {}, visibilityState: "visible" };

// IndexedDB finto: un solo archivio chiave→testo, condiviso (come lo è tra le schede dello stesso sito).
const idb = new Map<string, string>();
const fakeDb = {
  transaction(_store: string, mode: string) {
    const ops: (() => void)[] = [];
    const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: () => unknown } = {
      objectStore: () => ({
        get(k: string) { const r: { result?: unknown; onsuccess?: () => void } = {}; setTimeout(() => { r.result = idb.get(k); r.onsuccess?.(); }, 0); return r; },
        put(v: string, k: string) { ops.push(() => { idb.set(k, v); }); },
        delete(k: string) { ops.push(() => { idb.delete(k); }); },
      }),
    };
    if (mode === "readwrite") setTimeout(() => { ops.forEach((f) => f()); tx.oncomplete?.(); }, 0);
    return tx;
  },
};
g.indexedDB = { open: () => { const req: { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void } = {}; setTimeout(() => { req.result = fakeDb; req.onsuccess?.(); }, 0); return req; } };

const B = await import("../src/lib/bigstore.ts");
const DK = "spigolestay:data:v1";

async function fresh() {
  B.__resetBigStoreForTests(); B.setKvWriteGuard(null); ls.clear(); idb.clear();
  idb.set(DK, "dati-di-A");
  await B.initBigStore();
  assert.equal(B.bigStoreMemoryOnly(), false, "il finto IndexedDB funziona");
  assert.equal(B.kvGet(DK), "dati-di-A");
}

test("senza blocco: la scrittura in coda arriva su IndexedDB", async () => {
  await fresh();
  B.setKvWriteGuard(() => false);
  B.kvSet(DK, "A-nuovo");
  await B.kvFlush();
  assert.equal(idb.get(DK), "A-nuovo");
});

test("scrittura già in coda + guardia che scatta prima dello scarico: IndexedDB dell'altro account NON viene sovrascritto", async () => {
  await fresh();
  let paused = false;
  B.setKvWriteGuard(() => paused);
  B.kvSet(DK, "A-modifica-in-coda");      // scheda A ancora in regola: la scrittura entra in coda
  paused = true;                           // in un'altra scheda entra B (la guardia di A ora blocca)…
  idb.set(DK, "dati-di-B");                // …e scrive i suoi dati nell'IndexedDB condiviso
  await B.kvFlush();                       // lo scarico della coda di A
  assert.equal(idb.get(DK), "dati-di-B", "la coda di A è stata scartata, non scritta sopra B");
});

test("rimozione già in coda + guardia che scatta: i dati dell'altro account non vengono cancellati", async () => {
  await fresh();
  let paused = false;
  B.setKvWriteGuard(() => paused);
  B.kvRemove(DK);
  paused = true;
  idb.set(DK, "dati-di-B");
  await B.kvFlush();
  assert.equal(idb.get(DK), "dati-di-B");
});

test("dopo che la guardia si riapre le nuove scritture passano di nuovo", async () => {
  await fresh();
  let paused = true;
  B.setKvWriteGuard(() => paused);
  B.kvSet(DK, "scartata");                 // bloccata già in kvSet
  paused = false;
  B.kvSet(DK, "buona");
  await B.kvFlush();
  assert.equal(idb.get(DK), "buona");
});
