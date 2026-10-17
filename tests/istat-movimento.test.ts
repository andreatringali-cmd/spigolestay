import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

register("./helpers/alias-loader.mjs", import.meta.url);
const S = await import("../src/lib/istat/service.ts");
const { todayRome, addDaysYmd } = await import("../src/lib/dates-rome.ts");

const blob = {
  units: [{ id: "u1", structureId: "s1" }, { id: "u2", structureId: "s1" }, { id: "u3", structureId: "s1", outOfService: true }, { id: "u9", structureId: "s2" }],
  guests: [{ id: "g1", firstName: "Giulia", lastName: "Rossi", birthDate: "1950-01-01", sex: "F", citizenship: "Italia", birthPlace: "Roma" }],
  bookings: [
    { id: "b1", structureId: "s1", guestId: "g1", unitId: "u1", status: "confirmed", channel: "direct", checkIn: "2026-10-10", checkOut: "2026-10-12", adults: 1, children: 0,
      primaryGuest: { firstName: "Ugo", lastName: "Neri", birthDate: "1990-06-15", sex: "M", citizenship: "Germania", birthPlace: "Berlino" } },
  ],
};

test("movimento ISTAT: camere totali della struttura (senza fuori servizio), dati di chi ha fatto il check-in prima dell'anagrafica condivisa", () => {
  const m = S.buildDailyMovement(blob as never, "s1", "2026-10-10");
  assert.equal(m.camereTotali, 2);
  assert.equal(m.arrivati, 1);
  assert.equal(m.ospiti.length, 1);
  assert.equal(m.ospiti[0].cittadinanza, "Germania"); assert.equal(m.ospiti[0].sesso, "M"); assert.equal(m.ospiti[0].luogoNascita, "Berlino");
  assert.equal(m.ospiti[0].eta, 36);
});

test("movimento ISTAT: senza primaryGuest vale l'anagrafica", () => {
  const b2 = { ...blob, bookings: [{ ...blob.bookings[0], primaryGuest: undefined }] };
  const m = S.buildDailyMovement(b2 as never, "s1", "2026-10-10");
  assert.equal(m.ospiti[0].cittadinanza, "Italia"); assert.equal(m.ospiti[0].sesso, "F");
});

test("chiusura giornata: un giorno futuro o una data non valida si rifiutano prima di toccare i dati", async () => {
  const { client, db } = makeFakeDb({ istat_settings: [], istat_rows: [] });
  const fut = await S.closeDay(client as never, "t1", "s1", addDaysYmd(todayRome(), 2));
  assert.equal(fut.ok, false); assert.match(fut.message, /futuro/);
  const bad = await S.closeDay(client as never, "t1", "s1", "domani");
  assert.equal(bad.ok, false); assert.match(bad.message, /non valida/);
  assert.equal(db.log.filter((l) => l.table === "istat_rows").length, 0);
  // oggi invece prosegue (qui: nessuna riga da inviare)
  const today = await S.closeDay(client as never, "t1", "s1", todayRome());
  assert.match(today.message, /Nessuna riga/);
});
