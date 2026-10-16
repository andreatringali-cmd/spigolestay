import { test } from "node:test";
import assert from "node:assert/strict";

// Senza window/IndexedDB (come in questo ambiente di test o in navigazione privata) l'archivio deve comportarsi
// esattamente come localStorage.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
} as Storage;

const { initBigStore, kvGet, kvSet, kvRemove, kvKeys, kvFlush, __resetBigStoreForTests } = await import("../src/lib/bigstore.ts");

test("senza IndexedDB: passa tutto a localStorage", async () => {
  __resetBigStoreForTests();
  store.clear();
  await initBigStore();
  kvSet("spigolestay:data:v1", "grande");
  kvSet("spigolestay:altro", "piccolo");
  assert.equal(kvGet("spigolestay:data:v1"), "grande");
  assert.equal(store.get("spigolestay:data:v1"), "grande"); // finisce in localStorage come prima
  assert.deepEqual(kvKeys().sort(), ["spigolestay:altro", "spigolestay:data:v1"]);
  kvRemove("spigolestay:altro");
  assert.equal(kvGet("spigolestay:altro"), null);
  await kvFlush(); // non fa nulla e non si blocca
});

test("chiave assente: null", () => {
  assert.equal(kvGet("spigolestay:non-esiste"), null);
});

test("IndexedDB presente ma inutilizzabile (es. alcuni iPhone): il blocco grande resta in memoria e NON finisce in localStorage", async () => {
  __resetBigStoreForTests();
  store.clear();
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { addEventListener() {}, dispatchEvent() { return true; } };
  g.indexedDB = { open: () => { const req: { onerror?: () => void; error?: unknown } = { error: new Error("boom") }; setTimeout(() => req.onerror?.(), 0); return req; } };
  try {
    const { bigStoreMemoryOnly, lastIdbError } = await import("../src/lib/bigstore.ts");
    store.set("spigolestay:data:v1", "vecchia-copia"); // copia di una versione precedente
    await initBigStore();
    assert.equal(bigStoreMemoryOnly(), true);
    assert.equal(kvGet("spigolestay:data:v1"), "vecchia-copia"); // letta
    kvSet("spigolestay:data:v1", "x".repeat(10));
    assert.equal(kvGet("spigolestay:data:v1"), "xxxxxxxxxx");
    assert.equal(store.get("spigolestay:data:v1"), "vecchia-copia"); // MAI riscritta in localStorage (5 MB non bastano)
    kvSet("spigolestay:altro", "piccolo"); // le chiavi piccole restano in localStorage
    assert.equal(store.get("spigolestay:altro"), "piccolo");
    assert.match(lastIdbError(), /apertura/);
  } finally { delete g.window; delete g.indexedDB; __resetBigStoreForTests(); }
});
