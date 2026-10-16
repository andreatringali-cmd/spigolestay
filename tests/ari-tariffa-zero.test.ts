import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { buildAriPayload } = await import("../src/lib/channex-ari.ts");

const S = "S1";
const roomTypes = [{ id: "std", structureId: S, name: "Standard", beds: 2, basePrice: 80 }] as never[];
const units = [{ id: "u1", roomTypeId: "std", structureId: S, name: "1" }] as never[];
const map = { propertyId: "P", rooms: { std: { roomTypeId: "CSTD", ratePlanId: "RP" } } };
const { toISO } = await import("../src/lib/dates.ts");
const today = toISO(new Date()); // data locale, la stessa che usa buildAriPayload (non quella UTC: dopo mezzanotte le due differiscono)
const row = (overrides: Record<string, number>) =>
  buildAriPayload(map as never, S, roomTypes, units, [], overrides, { days: 2 }).restrictions.find((r) => r.date === today)!;

test("tariffa 0: giorno chiuso (stop_sell) e senza prezzo, non aperto a 0,00", () => {
  const r = row({ [`std|${today}`]: 0 });
  assert.equal(r.stop_sell, true);
  assert.equal(r.rate, undefined);
});

test("tariffa valida: prezzo inviato e nessuno stop_sell", () => {
  const r = row({ [`std|${today}`]: 95 });
  assert.equal(r.rate, "95.00");
  assert.equal(r.stop_sell, undefined);
});
