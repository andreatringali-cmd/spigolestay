import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { combineData } = await import("../src/lib/org-combine.ts");

const rooms = { bookings: [{ id: "b1", structureId: "rooms", unitId: "244d", updatedAt: 1000 }] };
const house = { bookings: [{ id: "b1", structureId: "house", unitId: "332d", updatedAt: 2000 }] };
const ids = (d: Record<string, unknown>) => (d.bookings as { id: string; structureId: string }[]).map((b) => `${b.id}@${b.structureId}`);

test("prenotazione spostata da una struttura all'altra: la copia piu' recente vince, in qualunque ordine arrivino le org", () => {
  assert.deepEqual(ids(combineData({}, [rooms, house])), ["b1@house"]);
  assert.deepEqual(ids(combineData({}, [house, rooms])), ["b1@house"]); // prima vinceva l'ultima org letta (la copia vecchia)
});

test("a parita' di data vince l'ultima org (comportamento di prima) e le prenotazioni uniche restano", () => {
  const a = { bookings: [{ id: "x", structureId: "a", updatedAt: 5 }, { id: "y", structureId: "a", updatedAt: 1 }] };
  const b = { bookings: [{ id: "x", structureId: "b", updatedAt: 5 }] };
  assert.deepEqual(ids(combineData({}, [a, b])).sort(), ["x@b", "y@a"]);
});

test("copia personale piu' vecchia di quella dell'org: vince l'org; piu' nuova: vince la personale", () => {
  assert.deepEqual(ids(combineData({ bookings: [{ id: "b1", structureId: "p", updatedAt: 3000 }] }, [house])), ["b1@p"]);
  assert.deepEqual(ids(combineData({ bookings: [{ id: "b1", structureId: "p", updatedAt: 1 }] }, [house])), ["b1@house"]);
});
