import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const C = await import("../src/lib/cron-auth.ts");

const req = (path: string, headers: Record<string, string> = {}) => new Request("https://xenora.it" + path, { headers });
const SECRET = "s3gr3to-di-prova-lungo";

test("Bearer corretto: autorizzato", () => {
  assert.equal(C.cronAuthorized(req("/api/cron/x", { authorization: `Bearer ${SECRET}` }), SECRET), true);
});
test("?secret= corretto: autorizzato (prova a mano)", () => {
  assert.equal(C.cronAuthorized(req(`/api/cron/x?secret=${SECRET}`), SECRET), true);
});
test("?key= solo se richiesto (channex/cron)", () => {
  assert.equal(C.cronAuthorized(req(`/api/channex/cron?key=${SECRET}`), SECRET), false);
  assert.equal(C.cronAuthorized(req(`/api/channex/cron?key=${SECRET}`), SECRET, ["key"]), true);
});
test("segreto sbagliato, di lunghezza diversa o vuoto: rifiutato", () => {
  assert.equal(C.cronAuthorized(req("/api/cron/x", { authorization: "Bearer sbagliato" }), SECRET), false);
  assert.equal(C.cronAuthorized(req("/api/cron/x", { authorization: `Bearer ${SECRET}x` }), SECRET), false);
  assert.equal(C.cronAuthorized(req("/api/cron/x?secret="), SECRET), false);
  assert.equal(C.cronAuthorized(req("/api/cron/x"), SECRET), false);
});
test("CRON_SECRET non configurato: nessuna richiesta è autorizzata, nemmeno con intestazione vuota", () => {
  assert.equal(C.cronAuthorized(req("/api/cron/x", { authorization: "Bearer " }), undefined), false);
  assert.equal(C.cronAuthorized(req("/api/cron/x?secret="), ""), false);
  assert.equal(C.cronAuthorized(req("/api/cron/x", { authorization: "Bearer abc" }), ""), false);
});
test("intestazione senza Bearer non vale come segreto", () => {
  assert.equal(C.cronAuthorized(req("/api/cron/x", { authorization: SECRET }), SECRET), false);
});
test("safeEqualStr: lunghezze diverse non lanciano", () => {
  assert.equal(C.safeEqualStr("a", "ab"), false);
  assert.equal(C.safeEqualStr("ab", "ab"), true);
  assert.equal(C.safeEqualStr("è", "e"), false);
});
