import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// buildAriPayload importa "@/lib/...": li risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const { buildAriPayload } = await import("../src/lib/channex-ari.ts");

// Caso reale di Central Perk (12/10/2026): 2 Standard (1, 2) e 2 Deluxe (3, 4). Due prenotazioni di tipologia Standard erano state
// spostate nelle camere Deluxe: il Calendario mostrava 0 Deluxe, ma ai portali ne risultavano 2 libere e la prenotazione è entrata.
const S = "S1";
const roomTypes = [
  { id: "std", structureId: S, name: "Standard", beds: 2, basePrice: 80 },
  { id: "dlx", structureId: S, name: "Deluxe", beds: 2, basePrice: 100 },
] as never[];
const units = [
  { id: "u1", roomTypeId: "std", structureId: S, name: "1" }, { id: "u2", roomTypeId: "std", structureId: S, name: "2" },
  { id: "u3", roomTypeId: "dlx", structureId: S, name: "3" }, { id: "u4", roomTypeId: "dlx", structureId: S, name: "4" },
] as never[];
const map = { propertyId: "P", rooms: { std: { roomTypeId: "CSTD" }, dlx: { roomTypeId: "CDLX" } } };
const b = (id: string, roomTypeId: string, unitId: string | null, checkIn: string, checkOut: string, status = "confirmed") => ({ id, structureId: S, roomTypeId, unitId, checkIn, checkOut, status });

const { toISO } = await import("../src/lib/dates.ts");
const today = toISO(new Date()); // data locale, la stessa che usa buildAriPayload (non quella UTC: dopo mezzanotte le due differiscono)
const plus = (n: number) => toISO(new Date(Date.now() + n * 86400000));
const avail = (bookings: unknown[], room: string, iso: string) =>
  buildAriPayload(map as never, S, roomTypes, units, bookings as never[], {}, { days: 5 }).availability.find((a) => a.room_type_id === room && a.date === iso)?.availability;

test("una prenotazione Standard spostata in una camera Deluxe occupa una Deluxe e libera una Standard", () => {
  const bookings = [b("a", "std", "u3", today, plus(2)), b("c", "std", "u4", today, plus(2))];
  assert.equal(avail(bookings, "CDLX", today), 0);
  assert.equal(avail(bookings, "CSTD", today), 2);
});

test("senza spostamenti il conteggio non cambia", () => {
  const bookings = [b("a", "dlx", "u3", today, plus(2)), b("c", "std", "u1", today, plus(2))];
  assert.equal(avail(bookings, "CDLX", today), 1);
  assert.equal(avail(bookings, "CSTD", today), 1);
});

test("prenotazione senza camera assegnata: vale la tipologia scelta; annullate ignorate", () => {
  const bookings = [b("a", "dlx", null, today, plus(1)), b("c", "dlx", "u3", today, plus(1), "cancelled")];
  assert.equal(avail(bookings, "CDLX", today), 1);
});
