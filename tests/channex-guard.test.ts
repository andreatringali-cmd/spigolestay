import test from "node:test";
import assert from "node:assert/strict";
import { ratePlanBelongsTo, type RatePlanLookup } from "../src/lib/channex-guard.ts";

// Finto Channex: P1 ha le tipologie RT1 (piano RP1) e RT2 (piano RP2); P9 (di un altro tenant) ha RT9 (piano RP9).
const calls: string[] = [];
const api: RatePlanLookup = {
  listRoomTypeIds: async (p) => { calls.push(`rt:${p}`); return ({ P1: ["RT1", "RT2", "RT3"], P9: ["RT9"] } as Record<string, string[]>)[p] ?? []; },
  listRatePlanIds: async (rt) => { calls.push(`rp:${rt}`); return ({ RT1: ["RP1"], RT2: ["RP2"], RT3: ["RP3"], RT9: ["RP9"] } as Record<string, string[]>)[rt] ?? []; },
};

test("ratePlanBelongsTo: piano di una propria tipologia già mappata (nessun elenco tipologie)", async () => {
  calls.length = 0;
  assert.equal(await ratePlanBelongsTo("RP2", [{ propertyId: "P1", roomTypeIds: ["RT1", "RT2"] }], api), true);
  assert.ok(!calls.some((c) => c.startsWith("rt:")));
});
test("ratePlanBelongsTo: tipologia non mappata → ripiego sull'elenco Channex della property", async () => {
  assert.equal(await ratePlanBelongsTo("RP3", [{ propertyId: "P1", roomTypeIds: ["RT1"] }], api), true);
});
test("ratePlanBelongsTo: piano di un altro tenant o inesistente → false", async () => {
  assert.equal(await ratePlanBelongsTo("RP9", [{ propertyId: "P1", roomTypeIds: ["RT1", "RT2"] }], api), false);
  assert.equal(await ratePlanBelongsTo("XX", [{ propertyId: "P1", roomTypeIds: [] }], api), false);
  assert.equal(await ratePlanBelongsTo("", [{ propertyId: "P1", roomTypeIds: ["RT1"] }], api), false);
  assert.equal(await ratePlanBelongsTo("RP1", [], api), false); // nessuna property collegata
});
test("ratePlanBelongsTo: non interroga due volte la stessa tipologia", async () => {
  calls.length = 0;
  await ratePlanBelongsTo("RP9", [{ propertyId: "P1", roomTypeIds: ["RT1"] }], api);
  assert.equal(calls.filter((c) => c === "rp:RT1").length, 1);
});
