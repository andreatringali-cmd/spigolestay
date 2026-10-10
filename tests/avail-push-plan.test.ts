import test from "node:test";
import assert from "node:assert/strict";
import { planAvailabilityPush, restrictMapRooms, changedAvailRows, rememberAvailRows, AVAIL_CACHE_TTL_MS, type AvailCache } from "../src/lib/avail-push-plan.ts";

const off = { enabled: false, structureIds: [] as string[] };
const on = { enabled: true, structureIds: ["H", "R"] };

test("senza gruppo: solo la struttura della prenotazione, solo la tipologia coinvolta", () => {
  const plan = planAvailabilityPush(off, ["H", "R", "X"], [{ structureId: "X", roomTypeId: "t1" }, { structureId: "X", roomTypeId: "t2" }, { structureId: "X", roomTypeId: "t1" }]);
  assert.deepEqual(plan, [{ structureId: "X", roomTypeIds: ["t1", "t2"] }]);
});

test("senza gruppo: più strutture coinvolte, ciascuna con le sue tipologie", () => {
  const plan = planAvailabilityPush(off, ["H", "R"], [{ structureId: "H", roomTypeId: "a" }, { structureId: "R", roomTypeId: "b" }]);
  assert.deepEqual(plan, [{ structureId: "H", roomTypeIds: ["a"] }, { structureId: "R", roomTypeIds: ["b"] }]);
});

test("tipologia sconosciuta: tutte le tipologie della struttura", () => {
  const plan = planAvailabilityPush(off, ["H"], [{ structureId: "H", roomTypeId: "a" }, { structureId: "H" }, { structureId: "H", roomTypeId: "b" }]);
  assert.deepEqual(plan, [{ structureId: "H", roomTypeIds: null }]);
});

test("struttura non mappata su Channex: niente da inviare", () => {
  assert.deepEqual(planAvailabilityPush(off, ["H"], [{ structureId: "Z", roomTypeId: "a" }]), []);
});

test("gruppo attivo: una prenotazione di una struttura del gruppo invia tutto il gruppo, tutte le tipologie", () => {
  const plan = planAvailabilityPush(on, ["H", "R", "X"], [{ structureId: "R", roomTypeId: "a" }]);
  assert.deepEqual(plan, [{ structureId: "H", roomTypeIds: null }, { structureId: "R", roomTypeIds: null }]);
});

test("gruppo attivo + prenotazione fuori dal gruppo: gruppo non inviato, solo la struttura coinvolta", () => {
  const plan = planAvailabilityPush(on, ["H", "R", "X"], [{ structureId: "X", roomTypeId: "a" }]);
  assert.deepEqual(plan, [{ structureId: "X", roomTypeIds: ["a"] }]);
});

test("gruppo attivo: si inviano solo le strutture del gruppo che hanno la mappatura", () => {
  assert.deepEqual(planAvailabilityPush(on, ["H"], [{ structureId: "H" }]), [{ structureId: "H", roomTypeIds: null }]);
});

test("senza indicazioni: gruppo attivo → il gruppo (comportamento storico); altrimenti tutte le mappate", () => {
  assert.deepEqual(planAvailabilityPush(on, ["H", "R", "X"]), [{ structureId: "H", roomTypeIds: null }, { structureId: "R", roomTypeIds: null }]);
  assert.deepEqual(planAvailabilityPush(off, ["H", "R"], []), [{ structureId: "H", roomTypeIds: null }, { structureId: "R", roomTypeIds: null }]);
  assert.deepEqual(planAvailabilityPush(on, ["X"]), []);
});

test("restrictMapRooms tiene solo le tipologie richieste", () => {
  const map = { propertyId: "p", rooms: { a: { roomTypeId: "A" }, b: { roomTypeId: "B" } } };
  assert.deepEqual(Object.keys(restrictMapRooms(map, ["b"]).rooms), ["b"]);
  assert.equal(restrictMapRooms(map, null), map);
  assert.deepEqual(Object.keys(map.rooms), ["a", "b"]); // l'originale non cambia
});

test("confronto con l'ultimo invio: solo le righe cambiate, scadenza TTL, nessuna memoria se l'invio fallisce", () => {
  const cache: AvailCache = new Map();
  const r = (date: string, availability: number) => ({ property_id: "p", room_type_id: "r", date, availability });
  const first = [r("2026-10-10", 2), r("2026-10-11", 2)];
  assert.equal(changedAvailRows(first, cache, 1000).length, 2);
  // invio fallito: non si chiama rememberAvailRows → si rimanda tutto
  assert.equal(changedAvailRows(first, cache, 2000).length, 2);
  rememberAvailRows(first, cache, 1000);
  assert.equal(changedAvailRows(first, cache, 2000).length, 0);
  assert.deepEqual(changedAvailRows([r("2026-10-10", 1), r("2026-10-11", 2)], cache, 2000), [r("2026-10-10", 1)]);
  assert.equal(changedAvailRows(first, cache, 1000 + AVAIL_CACHE_TTL_MS + 1).length, 2); // voce scaduta
});
