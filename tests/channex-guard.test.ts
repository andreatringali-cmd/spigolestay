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

// ── allowedChannexProperties: i soci disattivati non contano ──
import { allowedChannexProperties, allowedChannexMapRows, activeOrgIds } from "../src/lib/channex-guard.ts";
type R = Record<string, unknown>;
function fakeAdmin(tables: Record<string, R[]>) {
  return {
    from(table: string) {
      const fs: ((r: R) => boolean)[] = [];
      const q = {
        select() { return q; },
        eq(c: string, v: unknown) { fs.push((r) => r[c] === v); return q; },
        in(c: string, v: unknown[]) { fs.push((r) => v.includes(r[c])); return q; },
        then(res: (v: { data: R[]; error: null }) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve({ data: (tables[table] ?? []).filter((r) => fs.every((f) => f(r))), error: null }).then(res, rej); },
      };
      return q;
    },
  } as never;
}
const tables = {
  channex_map: [
    { tenant_id: "me", org_id: null, channex_property_id: "P-own", rooms: { rt1: "x" } },
    { tenant_id: "owner", org_id: "ORG-A", channex_property_id: "P-A", rooms: {} },
    { tenant_id: "owner2", org_id: "ORG-B", channex_property_id: "P-B", rooms: {} },
  ],
  memberships: [
    { user_id: "me", org_id: "ORG-A", active: true },
    { user_id: "me", org_id: "ORG-B", active: false },
  ],
};

test("activeOrgIds: salta i soci con active === false, tiene true e null/assente", () => {
  assert.deepEqual(activeOrgIds([{ org_id: "a", active: true }, { org_id: "b", active: false }, { org_id: "c" }, { org_id: "d", active: null }, { active: true }]), ["a", "c", "d"]);
  assert.deepEqual(activeOrgIds(null), []);
});
test("allowedChannexProperties: la property di una struttura condivisa con socio disattivato non è consentita", async () => {
  const p = await allowedChannexProperties(fakeAdmin(tables), "me");
  assert.deepEqual([...p].sort(), ["P-A", "P-own"]);
  assert.ok(!p.has("P-B"));
});
test("allowedChannexMapRows: stesso filtro sui soci attivi", async () => {
  const rows = await allowedChannexMapRows(fakeAdmin(tables), "me");
  assert.deepEqual(rows.map((r) => r.propertyId).sort(), ["P-A", "P-own"]);
});
