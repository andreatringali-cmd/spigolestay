import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyMetaSignature, metaSignature, safeEqualStr } from "../src/lib/meta-signature.ts";

const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1" }] });
const secret = "s3cret";
const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

test("firma valida → accettata", () => {
  assert.deepEqual(verifyMetaSignature(body, good, { META_APP_SECRET: secret }), { accept: true, reason: "ok" });
});
test("firma valida su Buffer → accettata", () => {
  assert.equal(verifyMetaSignature(Buffer.from(body), good, { META_APP_SECRET: secret }).accept, true);
});
test("firma in maiuscolo esadecimale → accettata", () => {
  const up = "sha256=" + good.slice(7).toUpperCase();
  assert.equal(verifyMetaSignature(body, up, { META_APP_SECRET: secret }).accept, true);
});
test("firma errata → rifiutata", () => {
  const bad = "sha256=" + "0".repeat(64);
  assert.deepEqual(verifyMetaSignature(body, bad, { META_APP_SECRET: secret }), { accept: false, reason: "bad_signature" });
});
test("corpo modificato → rifiutato", () => {
  assert.equal(verifyMetaSignature(body + " ", good, { META_APP_SECRET: secret }).accept, false);
});
test("firma di lunghezza diversa o senza prefisso → rifiutata senza eccezioni", () => {
  assert.equal(verifyMetaSignature(body, "sha256=abc", { META_APP_SECRET: secret }).accept, false);
  assert.equal(verifyMetaSignature(body, good.slice(7), { META_APP_SECRET: secret }).accept, false);
});
test("firma assente con segreto presente → rifiutata", () => {
  assert.deepEqual(verifyMetaSignature(body, null, { META_APP_SECRET: secret }), { accept: false, reason: "missing_signature" });
  assert.equal(verifyMetaSignature(body, "", { META_APP_SECRET: secret }).accept, false);
});
test("segreto mancante: fail-open (accettata) senza strict", () => {
  assert.deepEqual(verifyMetaSignature(body, null, {}), { accept: true, reason: "no_secret" });
  assert.deepEqual(verifyMetaSignature(body, good, { META_APP_SECRET: "  " }), { accept: true, reason: "no_secret" });
});
test("segreto mancante con WHATSAPP_WEBHOOK_STRICT=1 → rifiutata", () => {
  assert.deepEqual(verifyMetaSignature(body, good, { WHATSAPP_WEBHOOK_STRICT: "1" }), { accept: false, reason: "no_secret_strict" });
});
test("strict con segreto e firma corretta → accettata", () => {
  assert.equal(verifyMetaSignature(body, good, { META_APP_SECRET: secret, WHATSAPP_WEBHOOK_STRICT: "1" }).accept, true);
});
test("safeEqualStr: uguali / diverse / lunghezze diverse", () => {
  assert.equal(safeEqualStr("abc", "abc"), true);
  assert.equal(safeEqualStr("abc", "abd"), false);
  assert.equal(safeEqualStr("abc", "abcd"), false);
  assert.equal(metaSignature(body, secret), good);
});
