import test from "node:test";
import assert from "node:assert/strict";
import { isBedAndBreakfastIt } from "../src/lib/channel-name.ts";

test("bb.it: riconosciuto con i nomi che arrivano davvero da Channex", () => {
  for (const n of ["bb.it", "BB.IT", "bbit", "BedAndBreakfast", "Bed and Breakfast", "Bed & Breakfast Italia", "bed-and-breakfast.it", "Bed and Breakfast .it", "B&B.it"]) {
    assert.equal(isBedAndBreakfastIt(n), true, n);
  }
});

test("bb.it: non confonde catene e altre OTA", () => {
  for (const n of ["B&B Hotels", "B&B Hotel Italia", "Booking.com", "Airbnb", "Bed and Breakfast Europe", "bed-and-breakfast.com", "bed-and-breakfast.eu", "bed-and-breakfast.nl", "", undefined]) {
    assert.equal(isBedAndBreakfastIt(n), false, String(n));
  }
});

import { otaGroupName } from "../src/lib/channel-name.ts";

test("otaGroupName: nome comune solo se tutte le prenotazioni coincidono", () => {
  assert.deepEqual(otaGroupName(["bb.it", "BB.IT ", "bb.it"]), { name: "bb.it", mixed: false });
  assert.deepEqual(otaGroupName(["bb.it", "HotelBeds"]), { name: undefined, mixed: true });
  assert.deepEqual(otaGroupName(["bb.it", undefined]), { name: undefined, mixed: true });
  assert.deepEqual(otaGroupName([undefined, undefined]), { name: undefined, mixed: false });
  assert.deepEqual(otaGroupName([]), { name: undefined, mixed: false });
});
