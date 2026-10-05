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
