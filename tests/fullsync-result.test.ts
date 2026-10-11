import test from "node:test";
import assert from "node:assert/strict";
import { esitoFullSync, ESITO_NON_CONFERMATO } from "../src/lib/fullsync-result.ts";

test("full sync riuscito solo se entrambe le parti sono accettate", () => {
  assert.equal(esitoFullSync({ availOk: true, restrOk: true }).ok, true);
  assert.equal(esitoFullSync({ availOk: true, restrOk: false }).ok, false);
  assert.equal(esitoFullSync({ availOk: false, restrOk: true }).ok, false);
});

test("l'errore riporta quale parte è fallita e il motivo", () => {
  const e = esitoFullSync({ availOk: true, restrOk: false, restrError: "HTTP 422" });
  assert.match(e.message, /restrizioni\/prezzi non accettati \(HTTP 422\)/);
  assert.doesNotMatch(e.message, /disponibilità non accettata/);
  assert.match(esitoFullSync({ availOk: false, restrOk: false, error: "rete assente" }).message, /rete assente/);
});

test("mancata conferma: non è un successo", () => {
  assert.equal(ESITO_NON_CONFERMATO.ok, false);
  assert.match(ESITO_NON_CONFERMATO.message, /controlla lo stato in Canali/);
});
