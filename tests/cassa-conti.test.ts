import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { DEFAULT_CONTI, loadConti, saveConti, contoKeyFromLabel, canDeleteConto, OPENING_CAT } = await import("../src/lib/cassa.ts");

const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = v; } };

test("chiave del conto dal nome, senza accenti e senza doppioni", () => {
  assert.equal(contoKeyFromLabel("Revolut", DEFAULT_CONTI), "conto-revolut");
  assert.equal(contoKeyFromLabel("Banca Intesa Sanpaolo SPA", DEFAULT_CONTI), "conto-banca-intesa-sanpaolo-sp");
  assert.equal(contoKeyFromLabel("Cassa è Città", DEFAULT_CONTI), "conto-cassa-e-citta");
  const existing = [...DEFAULT_CONTI, { key: "conto-revolut", label: "Revolut" }];
  assert.equal(contoKeyFromLabel("Revolut", existing), "conto-revolut-2");
  assert.equal(contoKeyFromLabel("???", DEFAULT_CONTI), "conto-conto");
});

test("i conti di base ci sono sempre; si salvano e ricaricano solo quelli aggiunti", () => {
  assert.deepEqual(loadConti().map((c) => c.key), ["contanti", "banca", "paypal", "carta"]);
  saveConti([...DEFAULT_CONTI, { key: "conto-revolut", label: "Revolut" }, { key: "conto-baps", label: "BAPS" }]);
  assert.deepEqual(JSON.parse(store["spigolestay:cassa:conti"]).map((c: { key: string }) => c.key), ["conto-revolut", "conto-baps"]);
  assert.deepEqual(loadConti().map((c) => c.label), ["Contanti", "Banca", "PayPal", "Carta / POS", "Revolut", "BAPS"]);
});

test("dati salvati rovinati non rompono il caricamento", () => {
  store["spigolestay:cassa:conti"] = "non è json";
  assert.equal(loadConti().length, 4);
  store["spigolestay:cassa:conti"] = JSON.stringify([{ key: "banca", label: "doppione" }, { key: "", label: "x" }, null, { key: "conto-ok", label: "Ok" }]);
  assert.deepEqual(loadConti().map((c) => c.key), ["contanti", "banca", "paypal", "carta", "conto-ok"]);
});

test("rinominare un conto di base o aggiunto: la chiave resta, cambia il nome", () => {
  store["spigolestay:cassa:conti"] = "[]";
  const list = loadConti().map((c) => (c.key === "banca" ? { ...c, label: "Banca principale" } : c));
  saveConti([...list, { key: "conto-revolut", label: "Revolut" }]);
  const again = loadConti();
  assert.equal(again.find((c) => c.key === "banca")?.label, "Banca principale");
  assert.equal(again.find((c) => c.key === "conto-revolut")?.label, "Revolut");
  assert.equal(again.length, 5);
});

test("eliminare un conto di base (PayPal): non compare più; i conti aggiunti si tolgono dall'elenco", () => {
  store["spigolestay:cassa:conti"] = "[]";
  const without = loadConti().filter((c) => c.key !== "paypal");
  saveConti([...without, { key: "conto-baps", label: "BAPS" }]);
  assert.deepEqual(loadConti().map((c) => c.key), ["contanti", "banca", "carta", "conto-baps"]);
  saveConti(loadConti().filter((c) => c.key !== "conto-baps"));
  assert.deepEqual(loadConti().map((c) => c.key), ["contanti", "banca", "carta"]);
});

test("conti eliminabili: non quelli fissi, non quelli con movimenti o pagamenti programmati; il saldo di partenza non conta", () => {
  const mv = (id: string, conto: string, cat = "altro") => ({ id, date: "2026-10-01", kind: "in" as const, cat, desc: id, amount: 10, conto });
  assert.equal(canDeleteConto("banca", [], []).ok, false);
  assert.equal(canDeleteConto("contanti", [], []).ok, false);
  assert.equal(canDeleteConto("conto-baps", [mv("a", "conto-baps", OPENING_CAT)], []).ok, true);
  assert.equal(canDeleteConto("conto-baps", [mv("a", "conto-baps")], []).ok, false);
  assert.equal(canDeleteConto("paypal", [], [{ conto: "paypal" }]).ok, false);
  assert.equal(canDeleteConto("paypal", [mv("b", "banca")], []).ok, true);
});
