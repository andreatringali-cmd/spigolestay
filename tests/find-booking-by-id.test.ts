import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Ricerca prenotazione col solo id (link /checkin?b=… senza slug): il tetto conta solo le ricerche FALLITE,
// così gli id veri (già trovati) non vengono mai bloccati da chi spara id inventati.
register("./helpers/alias-loader.mjs", import.meta.url);
const { findBookingStoreById, _resetFindByIdState } = await import("../src/lib/manage-booking.ts");

const DATA_KEY = "spigolestay:data:v1";
function setup() {
  _resetFindByIdState();
  const data = { structures: [{ id: "st-1" }], bookings: [{ id: "b-ok", structureId: "st-1", guestId: "g1" }], guests: [{ id: "g1" }], roomTypes: [] };
  const { db, client } = makeFakeDb({
    org_state: [],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }],
  });
  return { db, admin: client as never };
}

test("id valido: trovato", async () => {
  const { admin } = setup();
  const st = await findBookingStoreById(admin, "b-ok");
  assert.equal(st?.keyVal, "owner-1");
});

test("60 id inventati saturano il tetto, ma l'id vero già trovato continua a funzionare", async () => {
  const { admin } = setup();
  assert.ok(await findBookingStoreById(admin, "b-ok")); // prima ricerca riuscita → in cache
  for (let i = 0; i < 60; i++) assert.equal(await findBookingStoreById(admin, "x" + i), null);
  assert.ok(await findBookingStoreById(admin, "b-ok"), "l'ospite vero non deve ricevere 404");
});

test("le ricerche riuscite non consumano il tetto", async () => {
  const { admin } = setup();
  for (let i = 0; i < 200; i++) assert.ok(await findBookingStoreById(admin, "b-ok"));
  assert.equal(await findBookingStoreById(admin, "inesistente"), null);
});

test("oltre il tetto dei miss non si scansiona più il database", async () => {
  const { db, admin } = setup();
  for (let i = 0; i < 60; i++) await findBookingStoreById(admin, "x" + i);
  const before = db.log.length;
  assert.equal(await findBookingStoreById(admin, "ancora-inventato"), null);
  assert.equal(db.log.length, before);
});

test("id vuoto o enorme: scartato senza toccare il database", async () => {
  const { db, admin } = setup();
  assert.equal(await findBookingStoreById(admin, ""), null);
  assert.equal(await findBookingStoreById(admin, "a".repeat(101)), null);
  assert.equal(db.log.length, 0);
});
