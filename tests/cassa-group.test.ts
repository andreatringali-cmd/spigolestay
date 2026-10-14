import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { groupBookingRows } = await import("../src/lib/cassa.ts");

const inc = (id: string, amount: number) => ({ id: `auto-in-${id}`, date: "2026-08-21", kind: "in" as const, cat: "prenotazioni", desc: "Di Napoli Anna · Spigolehouse · Booking.com", amount, conto: "banca", auto: true, ref: id });
const com = (id: string, amount: number) => ({ id: `auto-comm-${id}`, date: "2026-08-21", kind: "out" as const, cat: "commissioni", desc: "Commissione Booking.com · Di Napoli Anna", amount, conto: "banca", auto: true, ref: id });
const manual = { id: "m1", date: "2026-08-22", kind: "out" as const, cat: "utenze", desc: "Luce", amount: 80, conto: "banca" };

test("incasso e commissione della stessa prenotazione → una sola voce con lordo, commissioni e netto", () => {
  const rows = groupBookingRows([com("b1", 207.52), inc("b1", 854.37), manual]);
  assert.equal(rows.length, 2);
  const b = rows[0];
  assert.equal(b.type, "booking");
  if (b.type === "booking") { assert.equal(b.gross, 854.37); assert.equal(b.comm, 207.52); assert.equal(b.net, 646.85); assert.equal(b.id, "b1"); }
  assert.equal(rows[1].type, "mov");
});

test("senza commissione (o senza incasso) restano voci normali", () => {
  assert.deepEqual(groupBookingRows([inc("b2", 100)]).map((r) => r.type), ["mov"]);
  assert.deepEqual(groupBookingRows([com("b3", 20)]).map((r) => r.type), ["mov"]);
});

test("prenotazioni diverse non si mescolano; l'ordine è quello dei movimenti", () => {
  const rows = groupBookingRows([inc("a", 100), com("a", 15), inc("b", 200), com("b", 30)]);
  assert.deepEqual(rows.map((r) => (r.type === "booking" ? r.id : "x")), ["a", "b"]);
});

test("prenotazione ancora da incassare (previsione) + commissione → una sola voce", () => {
  const fc = { id: "fc-in-b9", date: "2026-10-14", kind: "in" as const, cat: "prenotazioni", desc: "Amir Oscar · da incassare", amount: 79.2, conto: "banca", forecast: true, ref: "b9" };
  const rows = groupBookingRows([com("b9", 19.41), fc]);
  assert.equal(rows.length, 1);
  const b = rows[0];
  assert.equal(b.type, "booking");
  if (b.type === "booking") { assert.equal(b.gross, 79.2); assert.equal(b.comm, 19.41); assert.equal(b.net, 59.79); }
});

test("parzialmente incassata: la voce unica usa l'incasso, il 'da incassare' resta a parte", () => {
  const fc = { id: "fc-in-b8", date: "2026-10-20", kind: "in" as const, cat: "prenotazioni", desc: "x · da incassare", amount: 200, conto: "banca", forecast: true, ref: "b8" };
  const rows = groupBookingRows([inc("b8", 100), com("b8", 30), fc]);
  assert.deepEqual(rows.map((r) => r.type), ["booking", "mov"]);
});
