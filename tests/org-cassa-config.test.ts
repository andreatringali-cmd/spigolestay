import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { orgStructureSets, extractOrgCassaConfig, applyOrgCassaConfig, CASSA_CONTI_KEY: C, CASSA_PAYOUTS_KEY: P, CASSA_PREFS_KEY: R } = await import("../src/lib/org-cassa-config.ts");

const CP = new Set(["cp"]);
const conti = [{ key: "banca", label: "Baps", structureIds: ["sh"] }, { key: "conto-revolut@cp", label: "Revolut", structureIds: ["cp"] }, { key: "conto-x", label: "Libero" }];
const local = { [C]: JSON.stringify(conti), [P]: JSON.stringify({ "*": { booking: { mode: "weekly" } }, cp: { booking: { mode: "monthly" } }, sh: { booking: { mode: "arrival" } } }), [R]: JSON.stringify({ order: ["banca"], principal: "banca", principalBy: { cp: "conto-revolut@cp", sh: "banca" } }) };

test("strutture per org dal blob dati", () => {
  const m = orgStructureSets({ structures: [{ id: "cp", orgId: "o1" }, { id: "sh", orgId: "o2" }, { id: "sr", orgId: "o2" }, { id: "own" }] });
  assert.deepEqual([...m.get("o1")!], ["cp"]); assert.deepEqual([...m.get("o2")!], ["sh", "sr"]); assert.equal(m.size, 2);
});

test("estrae solo la parte dell'org (conti assegnati solo alle sue strutture, regole e conto principale)", () => {
  const out = extractOrgCassaConfig(local, CP);
  assert.deepEqual(JSON.parse(out[C]), [conti[1]]);
  assert.deepEqual(JSON.parse(out[P]), { cp: { booking: { mode: "monthly" } } });
  assert.deepEqual(JSON.parse(out[R]), { principalBy: { cp: "conto-revolut@cp" } });
});

test("parte vuota: nessuna chiave (non deve cancellare quella del server)", () => {
  assert.deepEqual(extractOrgCassaConfig({ [C]: JSON.stringify([conti[0]]) }, CP), {});
  assert.deepEqual(extractOrgCassaConfig({}, CP), {});
});

test("un socio senza conti di Central Perk riceve quelli dell'org, senza toccare i suoi", () => {
  const mine = { [C]: JSON.stringify([{ key: "banca", label: "Mia banca" }]) };
  const org = { [C]: JSON.stringify([conti[1]]), [P]: JSON.stringify({ cp: { booking: { mode: "monthly" } } }), [R]: JSON.stringify({ principalBy: { cp: "conto-revolut@cp" } }) };
  const out = applyOrgCassaConfig(mine, org, CP);
  assert.deepEqual(JSON.parse(out[C]), [{ key: "banca", label: "Mia banca" }, conti[1]]);
  assert.deepEqual(JSON.parse(out[P]), { cp: { booking: { mode: "monthly" } } });
  assert.deepEqual(JSON.parse(out[R]), { principalBy: { cp: "conto-revolut@cp" } });
});

test("sincronizzazione senza novità: nessuna chiave cambia (niente loop di salvataggi)", () => {
  assert.deepEqual(applyOrgCassaConfig(local, extractOrgCassaConfig(local, CP), CP), {});
});

test("un altro socio rinomina il conto e ne toglie uno: il locale lo adotta sul posto; i conti di altre strutture restano", () => {
  const org = { [C]: JSON.stringify([{ key: "conto-revolut@cp", label: "Revolut Business", structureIds: ["cp"] }]) };
  const l = { [C]: JSON.stringify([conti[0], conti[1], { key: "conto-old@cp", label: "Vecchio", structureIds: ["cp"] }, conti[2]]) };
  const out = applyOrgCassaConfig(l, org, CP);
  assert.deepEqual(JSON.parse(out[C]), [conti[0], { key: "conto-revolut@cp", label: "Revolut Business", structureIds: ["cp"] }, conti[2]]);
});
