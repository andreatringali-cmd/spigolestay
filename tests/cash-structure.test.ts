import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { computeAuto, cashStructureOf, cashView } = await import("../src/lib/cassa.ts");

const guests = [{ id: "g1", fullName: "Anna" }];
const stx = (id: string) => ({ id, name: id === "s1" ? "Spigolehouse" : "Spigolerooms" });
// s1 (Spigolehouse): bonifico settimanale (giovedì). s2 (Spigolerooms): alla data di arrivo.
const MAP = { s1: { booking: { mode: "weekly", weekday: 4 } }, s2: { booking: { mode: "arrival" } } } as never;
const B = (o: Record<string, unknown> = {}) => ({ id: "b1", structureId: "s2", guestId: "g1", channel: "booking", status: "confirmed", checkIn: "2026-10-16", checkOut: "2026-10-18", total: 200, paid: 200, ...o });
const auto = (bks: unknown[], active = "all") => computeAuto(bks as never, guests as never, stx as never, active, "banca", MAP, ["banca", "contanti"]);

test("incassi: la struttura che incassa è quella che ha ricevuto la prenotazione (movedFrom), non quella dove sta la camera", () => {
  assert.equal(cashStructureOf({ structureId: "s2" }), "s2");
  assert.equal(cashStructureOf({ structureId: "s2", movedFrom: { structureId: "s1" } }), "s1");
  const b = { structureId: "s2", movedFrom: { structureId: "s1" } };
  assert.equal(cashView(b).structureId, "s1");
  assert.equal(cashView({ structureId: "s1" }).structureId, "s1");
});

test("prenotazione ricevuta da s1 e spostata in una camera di s2: l'incasso segue le regole di s1 e resta nella Cassa di s1", () => {
  const moved = B({ movedFrom: { structureId: "s1", structureName: "Spigolehouse", at: "2026-10-15T10:00:00Z" } });
  const inS1 = auto([moved], "s1").filter((m) => m.id.startsWith("auto-in-"));
  assert.equal(inS1.length, 1);
  assert.equal(inS1[0].date, "2026-10-22"); // giovedì dopo il check-out (regola di s1), non la data di arrivo di s2
  assert.equal(auto([moved], "s2").length, 0); // non compare nella Cassa di s2
  assert.equal(auto([moved], "all")[0].bookingStructureId, "s1");
});

test("senza spostamento tutto resta come prima", () => {
  const plain = B();
  const m = auto([plain], "s2").filter((x) => x.id.startsWith("auto-in-"));
  assert.equal(m.length, 1);
  assert.equal(m[0].date, "2026-10-16"); // arrivo: regola di s2
});
