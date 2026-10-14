import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { computeAuto, computeForecast, moveItem, sortConti, loadContiPrefs, saveContiPrefs, loadConti, saveConti, canDeleteConto, DEFAULT_CONTI } = await import("../src/lib/cassa.ts");

const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = v; } };

const guests = [{ id: "g1", fullName: "Anna" }];
const st = () => ({ id: "s1", name: "Spigolehouse" });
const bk = (o: Record<string, unknown>) => ({ id: "b1", structureId: "s1", guestId: "g1", channel: "booking", status: "confirmed", checkIn: "2026-10-20", checkOut: "2026-10-22", total: 300, paid: 300, ...o });

test("senza preferenze il conto principale è 'banca' (come prima)", () => {
  assert.deepEqual(loadContiPrefs(), { order: [], principal: "banca" });
  const a = computeAuto([bk({})] as never, guests as never, st as never, "all");
  assert.ok(a.filter((m) => m.auto).every((m) => m.conto === "banca"));
});

test("conto principale Revolut: incasso e commissione OTA vanno lì; le dirette restano sui contanti", () => {
  const a = computeAuto([bk({ id: "o1" }), bk({ id: "d1", channel: "direct" })] as never, guests as never, st as never, "all", "conto-revolut");
  assert.equal(a.find((m) => m.id === "auto-in-o1")?.conto, "conto-revolut");
  assert.equal(a.find((m) => m.id === "auto-comm-o1")?.conto, "conto-revolut");
  assert.equal(a.find((m) => m.id === "auto-in-d1")?.conto, "contanti");
  const f = computeForecast([bk({ id: "f1", paid: 0 })] as never, guests as never, st as never, [], "all", "2026-10-14", "2026-12-31", "conto-revolut");
  assert.equal(f[0].conto, "conto-revolut");
});

test("il principale si legge dalle preferenze salvate", () => {
  saveContiPrefs({ order: [], principal: "conto-revolut" });
  assert.equal(loadContiPrefs().principal, "conto-revolut");
  const a = computeAuto([bk({})] as never, guests as never, st as never, "all");
  assert.equal(a.find((m) => m.id === "auto-in-b1")?.conto, "conto-revolut");
});

test("ordine: sposta su/giù e ordina secondo le preferenze, i conti nuovi in coda", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  const l = ["a", "b", "c"]; assert.equal(moveItem(l, 0, -1), l); assert.equal(moveItem(l, 2, 1), l);
  const conti = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }, { key: "d", label: "D" }];
  assert.deepEqual(sortConti(conti, ["c", "a"]).map((c) => c.key), ["c", "a", "b", "d"]);
  assert.deepEqual(sortConti(conti, []).map((c) => c.key), ["a", "b", "c", "d"]);
});

test("l'ordine dei conti si salva e si ricarica con i nomi", () => {
  saveContiPrefs({ order: [], principal: "banca" });
  const list = [{ key: "conto-revolut", label: "Revolut" }, ...DEFAULT_CONTI];
  saveConti(list);
  assert.deepEqual(loadConti().map((c) => c.key), ["conto-revolut", "contanti", "banca", "paypal", "carta"]);
  assert.equal(loadContiPrefs().principal, "banca");
});

test("il conto principale non si elimina se passato tra i fissi", () => {
  assert.equal(canDeleteConto("conto-revolut", [], [], ["conto-revolut", "contanti"]).ok, false);
  assert.equal(canDeleteConto("banca", [], [], ["conto-revolut", "contanti"]).ok, true);
});
