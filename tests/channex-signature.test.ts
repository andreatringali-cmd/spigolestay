import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const S = await import("../src/lib/channex-signature.ts");

const SECRET = "whk_test_secret_123";
const env = { CHANNEX_SIGNING_SECRET: SECRET };
const NOW = 1_800_000_000;
const sign = (secret: string, ts: string | number, body: string) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
const hdrs = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
const BODY = '{"event":"message","payload":{"message":"Ciao è un test €","booking_id":"b1"}}'; // con caratteri non ASCII: contano i byte esatti

test("firma valida: accettata", () => {
  const h = hdrs({ "x-hmac-timestamp": String(NOW), "x-hmac-signature-256": sign(SECRET, NOW, BODY) });
  assert.equal(S.verifyChannexSignature(h, BODY, env, NOW).state, "valid");
});
test("corpo modificato o chiave diversa: respinta", () => {
  const h = hdrs({ "x-hmac-timestamp": String(NOW), "x-hmac-signature-256": sign(SECRET, NOW, BODY) });
  assert.deepEqual(S.verifyChannexSignature(h, BODY + " ", env, NOW), { state: "invalid", reason: "bad_signature" });
  const h2 = hdrs({ "x-hmac-timestamp": String(NOW), "x-hmac-signature-256": sign("altra", NOW, BODY) });
  assert.equal(S.verifyChannexSignature(h2, BODY, env, NOW).state, "invalid");
});
test("timestamp fuori tolleranza (replay) o malformato: respinto", () => {
  const old = NOW - 301;
  const h = hdrs({ "x-hmac-timestamp": String(old), "x-hmac-signature-256": sign(SECRET, old, BODY) });
  assert.deepEqual(S.verifyChannexSignature(h, BODY, env, NOW), { state: "invalid", reason: "stale_timestamp" });
  const edge = NOW - 300;
  assert.equal(S.verifyChannexSignature(hdrs({ "x-hmac-timestamp": String(edge), "x-hmac-signature-256": sign(SECRET, edge, BODY) }), BODY, env, NOW).state, "valid");
  assert.deepEqual(S.verifyChannexSignature(hdrs({ "x-hmac-timestamp": "abc", "x-hmac-signature-256": "00" }), BODY, env, NOW), { state: "invalid", reason: "bad_timestamp" });
  assert.equal(S.verifyChannexSignature(hdrs({ "x-hmac-signature-256": "00" }), BODY, env, NOW).state, "invalid"); // timestamp mancante
});
test("rotazione chiave: due firme separate da virgola, basta che una coincida", () => {
  const h = hdrs({ "x-hmac-timestamp": String(NOW), "x-hmac-signature-256": `${sign("vecchia", NOW, BODY)}, ${sign(SECRET, NOW, BODY).toUpperCase()}` });
  assert.equal(S.verifyChannexSignature(h, BODY, env, NOW).state, "valid");
});
test("senza intestazioni di firma: assente; firmata ma senza chiave configurata: no_key", () => {
  assert.equal(S.verifyChannexSignature(hdrs({}), BODY, env, NOW).state, "absent");
  const h = hdrs({ "x-hmac-timestamp": String(NOW), "x-hmac-signature-256": sign(SECRET, NOW, BODY) });
  assert.equal(S.verifyChannexSignature(h, BODY, {}, NOW).state, "no_key");
});
test("decideHook: la firma valida prevale sul vecchio segreto; la firma sbagliata respinge sempre", () => {
  const good = hdrs({ "x-hmac-timestamp": String(NOW), "x-hmac-signature-256": sign(SECRET, NOW, BODY) });
  assert.deepEqual(S.decideHook(good, BODY, { accept: false, reason: "bad_secret" }, env, NOW), { accept: true, reason: "signed", signed: true });
  const bad = hdrs({ "x-hmac-timestamp": String(NOW), "x-hmac-signature-256": "deadbeef" });
  assert.equal(S.decideHook(bad, BODY, { accept: true, reason: "ok" }, env, NOW).accept, false);
});
test("decideHook: richiesta non firmata → controllo storico; con CHANNEX_SIGNATURE_REQUIRED=1 rifiutata", () => {
  assert.equal(S.decideHook(hdrs({}), BODY, { accept: true, reason: "ok" }, env, NOW).accept, true);
  assert.equal(S.decideHook(hdrs({}), BODY, { accept: false, reason: "bad_secret" }, env, NOW).accept, false);
  const strict = { ...env, CHANNEX_SIGNATURE_REQUIRED: "1" };
  assert.deepEqual(S.decideHook(hdrs({}), BODY, { accept: true, reason: "ok" }, strict, NOW), { accept: false, reason: "missing_signature", signed: false });
  // firmata ma chiave non configurata da noi: ripiego sul controllo storico (non blocchiamo per una configurazione mancante)
  const h = hdrs({ "x-hmac-timestamp": String(NOW), "x-hmac-signature-256": sign(SECRET, NOW, BODY) });
  assert.equal(S.decideHook(h, BODY, { accept: true, reason: "ok" }, {}, NOW).accept, true);
});
