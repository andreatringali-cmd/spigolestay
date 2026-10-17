import test from "node:test";
import assert from "node:assert/strict";
import { ThreadCache, TtlFlags } from "../src/lib/channex-thread-cache.ts";
import type { OtaThread } from "../src/lib/channex-threads.ts";

const th = (id: string, bookingId = "", closed = false) => ({ id, bookingId, closed } as unknown as OtaThread);

test("ThreadCache: get/set, indice per prenotazione, anche per thread chiusi", () => {
  let now = 1000;
  const c = new ThreadCache(5 * 60_000, 100, () => now);
  c.set(th("t1", "B1")); c.set(th("t2", "B1", true)); c.set(th("t3", "B2")); c.set(th("t4"));
  assert.equal(c.get("t1")?.id, "t1");
  assert.deepEqual(c.ofBooking("B1").map((t) => t.id).sort(), ["t1", "t2"]);
  assert.deepEqual(c.ofBooking("B2").map((t) => t.id), ["t3"]);
  assert.deepEqual(c.ofBooking("B9"), []);
  c.delete("t1");
  assert.deepEqual(c.ofBooking("B1").map((t) => t.id), ["t2"]);
  c.delete("t2");
  assert.deepEqual(c.ofBooking("B1"), []);
});

test("ThreadCache: scadenza dopo il TTL (get e ofBooking)", () => {
  let now = 0;
  const c = new ThreadCache(1000, 100, () => now);
  c.set(th("t1", "B1"));
  now = 999; assert.ok(c.get("t1"));
  now = 1000; assert.equal(c.get("t1"), undefined);
  assert.deepEqual(c.ofBooking("B1"), []);
  assert.equal(c.size, 0);
});

test("ThreadCache: eviction sopra il massimo, prima le scadute poi svuota", () => {
  let now = 0;
  const c = new ThreadCache(1000, 3, () => now);
  c.set(th("a", "B1")); c.set(th("b", "B2"));
  now = 2000; // a e b scadute
  c.set(th("c", "B3")); // size 2 < 3: nessuna eviction, ma a/b restano scadute
  c.set(th("d", "B4")); // size 3 >= 3: via le scadute
  assert.equal(c.size, 2);
  assert.deepEqual(c.ofBooking("B1"), []);
  c.set(th("e", "B5")); // 3 voci
  c.set(th("f", "B6")); // tutte fresche e piene: si svuota, resta solo la nuova
  assert.equal(c.size, 1);
  assert.equal(c.get("f")?.id, "f");
  assert.deepEqual(c.ofBooking("B3"), []);
});

test("ThreadCache: se un thread cambia prenotazione l'indice resta coerente", () => {
  const c = new ThreadCache(60_000, 10);
  c.set(th("t1", "B1"));
  c.set(th("t1", "B2"));
  assert.deepEqual(c.ofBooking("B1"), []);
  assert.deepEqual(c.ofBooking("B2").map((t) => t.id), ["t1"]);
});

test("TtlFlags: «nessun thread» vale 60 s, poi scade; con tetto di dimensione", () => {
  let now = 0;
  const f = new TtlFlags(60_000, 3, () => now);
  f.set("P|B1");
  now = 59_999; assert.equal(f.has("P|B1"), true);
  now = 60_000; assert.equal(f.has("P|B1"), false);
  f.set("a"); f.set("b"); f.set("c");
  f.set("d"); // pieno e tutto fresco: si svuota
  assert.equal(f.size, 1);
  assert.equal(f.has("d"), true);
  f.delete("d"); assert.equal(f.has("d"), false);
});
