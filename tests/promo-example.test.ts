import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Gli import senza estensione si risolvono con l'hook di tests/helpers; le funzioni leggono localStorage: qui si simula.
register("./helpers/alias-loader.mjs", import.meta.url);
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0,
} as Storage;
const { isExamplePromo, realPromos } = await import("../src/lib/promo-example.ts");
const { DEFAULT_PROMOS } = await import("../src/lib/promos.ts");
const { resolveBookPromo } = await import("../src/lib/book-order.ts");
const { pickPreviewStructureId } = await import("../src/lib/publicdata.ts");

// Le offerte di esempio precaricate (Weekend Pasqua, Notte Gratis, Last Minute, Riprenota diretto) non sono promozioni vere della struttura:
// mai sul sito pubblico, mai come codici validi.

test("le promo precaricate sono di esempio, anche nei dati salvati prima del flag (id + nome + sconto + codice originali)", () => {
  for (const p of DEFAULT_PROMOS) assert.equal(isExamplePromo(p), true, p.name);
  const legacy = { id: "promo-pasqua", name: "Weekend Pasqua", discountPct: 15, code: "PASQUA15" };
  assert.equal(isExamplePromo(legacy), true);
  assert.equal(isExamplePromo({ id: "promo-riprenota", name: "Riprenota diretto", discountPct: 10, code: "RITORNO10" }), true);
});

test("una promo modificata dal titolare è vera: nome/sconto/codice diversi, oppure example=false", () => {
  assert.equal(isExamplePromo({ id: "promo-pasqua", name: "Pasqua in riva al mare", discountPct: 15, code: "PASQUA15" }), false);
  assert.equal(isExamplePromo({ id: "promo-pasqua", name: "Weekend Pasqua", discountPct: 20, code: "PASQUA15" }), false);
  assert.equal(isExamplePromo({ id: "promo-pasqua", name: "Weekend Pasqua", discountPct: 15, code: "PASQUA15", example: false }), false);
  assert.equal(isExamplePromo({ id: "xyz", name: "Estate 2027", discountPct: 10, code: "ESTATE" }), false);
  assert.equal(isExamplePromo(null), false);
});

test("realPromos toglie solo gli esempi", () => {
  const list = [...DEFAULT_PROMOS, { id: "mia", name: "Estate", discountPct: 10, code: "ESTATE10" }];
  assert.deepEqual(realPromos(list).map((p) => p.id), ["mia"]);
  assert.deepEqual(realPromos(DEFAULT_PROMOS), []); // niente offerte vere: la sezione «Offerte» del sito non compare
});

test("server: il codice di una promo di esempio non dà sconto; quello di una promo vera sì", () => {
  const o = { structureId: "s1", checkIn: "2026-12-01", today: "2026-10-19" };
  const promos = [...DEFAULT_PROMOS, { id: "mia", name: "Estate", discountPct: 10, code: "ESTATE10" }] as Record<string, unknown>[];
  assert.equal(resolveBookPromo(promos, "PASQUA15", o), null);
  assert.deepEqual(resolveBookPromo(promos, "estate10", o), { code: "ESTATE10", pct: 10 });
});

test("anteprima del titolare: struttura richiesta con ?s= (deve esistere), altrimenti la prima; nessuna struttura = niente anteprima", () => {
  const list = [{ id: "a" }, { id: "b" }];
  assert.equal(pickPreviewStructureId(list, "b"), "b");
  assert.equal(pickPreviewStructureId(list, null), "a");
  assert.equal(pickPreviewStructureId(list, "zzz"), null);
  assert.equal(pickPreviewStructureId([], "a"), null);
  assert.equal(pickPreviewStructureId([], null), null);
});
