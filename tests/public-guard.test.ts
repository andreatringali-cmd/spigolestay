import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const G = await import("../src/lib/public-guard.ts");

const req = (headers: Record<string, string> = {}) => new Request("https://xenora.it/api/x", { method: "POST", headers });

test("declaredTooLarge: oltre il tetto rifiutata, sotto o senza intestazione passa", () => {
  assert.equal(G.declaredTooLarge(req({ "content-length": "70000" }), 65536), true);
  assert.equal(G.declaredTooLarge(req({ "content-length": "65536" }), 65536), false);
  assert.equal(G.declaredTooLarge(req({ "content-length": "100" }), 65536), false);
  assert.equal(G.declaredTooLarge(req(), 65536), false);
  assert.equal(G.declaredTooLarge(req({ "content-length": "abc" }), 65536), false);
});

test("slugKey: minuscolo, tagliato, separato per funzione", () => {
  assert.equal(G.slugKey("pb", "Casa-A"), "pb:slug:casa-a");
  assert.notEqual(G.slugKey("pb", "x"), G.slugKey("pl", "x"));
  assert.equal(G.slugKey("pb", "a".repeat(500)).length, "pb:slug:".length + 80);
  assert.equal(G.SLUG_WINDOW_MS, 600000);
});

test("demoRequestLimited: 5 per IP ogni 10 minuti", () => {
  for (let i = 0; i < 5; i++) assert.equal(G.demoRequestLimited("1.2.3.4"), false);
  assert.equal(G.demoRequestLimited("1.2.3.4"), true);
  assert.equal(G.demoRequestLimited("5.6.7.8"), false);
});

test("tetti: valori sensati", () => {
  assert.ok(G.LIMITS.publicBookingBody >= 16 * 1024 && G.LIMITS.publicBookingBody <= 256 * 1024);
  assert.ok(G.LIMITS.publicBookingPerSlug >= 10);
});
