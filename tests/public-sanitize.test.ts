import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanStructure, cleanUnit, cleanBookings, STRUCT_PRIVATE, STRUCT_PUBLIC, UNIT_PRIVATE, UNIT_PUBLIC } from "../src/lib/publicsanitize.ts";

test("struttura: i campi sensibili non compaiono nello snapshot, quelli pubblici restano", () => {
  const st = {
    id: "s1", name: "Casa Test", city: "Siracusa", phone: "+39 0931 000000", email: "info@test.it", cin: "IT000", googlePlaceId: "gp1",
    vat: "IT123", taxCode: "RSSMRA", iban: "IT60X", ibanHolder: "Mario Rossi",
    accessInfo: "Portone 1313, keybox 4455", stripeAccount: "acct_123", stripeChargesEnabled: true,
    alloggiatiUser: "utente.questura", istat: "ISTAT9", gcalId: "cal@group.calendar.google.com", gcalVerifiedId: "cal@group",
    sdi: "ABCDEFG", pec: "x@pec.it", businessName: "Test SRL",
  };
  const out = cleanStructure(st);
  for (const k of STRUCT_PRIVATE) assert.ok(!(k in out), `campo privato pubblicato: ${k}`);
  assert.equal(out.name, "Casa Test");
  assert.equal(out.city, "Siracusa");
  assert.equal(out.cin, "IT000");
  assert.equal(out.googlePlaceId, "gp1");
  const json = JSON.stringify(out);
  for (const secret of ["1313", "acct_123", "utente.questura", "IT60X", "calendar.google.com", "ABCDEFG"]) assert.ok(!json.includes(secret), secret);
  assert.ok("accessInfo" in st, "l'originale non deve essere modificato");
});

test("camera: niente codici serratura, note interne e motivi di fuori servizio", () => {
  const u = { id: "u1", structureId: "s1", roomTypeId: "r1", name: "Allegra", accessInfo: "codice 2323", notes: "interna", oosReason: "perdita", floor: "1", outOfService: true };
  const out = cleanUnit(u);
  assert.ok(!("accessInfo" in out) && !("notes" in out) && !("oosReason" in out));
  assert.equal(out.name, "Allegra");
  assert.equal(out.outOfService, true);
});

test("prenotazioni: solo occupazione, id reali sostituiti da un indice, nessun dato ospite", () => {
  const bk = [
    { id: "real-uuid-1", structureId: "s1", roomTypeId: "r1", unitId: "u1", guestId: "g1", checkIn: "2026-10-01", checkOut: "2026-10-03", status: "confirmed", channel: "direct", total: 200, note: "tel 333", stripePaymentIntent: "pi_1", code: "SPG-1" },
    { id: "real-uuid-2", structureId: "s1", roomTypeId: "r1", checkIn: "2026-10-05", checkOut: "2026-10-06", status: "cancelled", channel: "booking" },
  ];
  const out = cleanBookings(bk);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].id, "real-uuid-1");
  assert.notEqual(out[0].id, out[1].id);
  assert.equal(out[1].unitId, null);
  const json = JSON.stringify(out);
  for (const secret of ["real-uuid", "g1", "333", "pi_1", "SPG-1", "200"]) assert.ok(!json.includes(secret), secret);
  assert.equal(out[0].checkIn, "2026-10-01");
  assert.equal(out[0].channel, "direct");
});

test("lista bianca: un campo nuovo o sconosciuto sulla struttura/camera NON finisce nello snapshot pubblico", () => {
  const st = { id: "s1", name: "Casa Test", city: "Siracusa", orgId: "org-segreta", contactName: "Mario Rossi", campoFuturo: "dato interno", webhookUrl: "https://x", checkInFrom: "15:00", depositPct: 30, logo: "data:image/png;base64,AA" };
  const out = cleanStructure(st);
  assert.deepEqual(Object.keys(out).sort(), ["checkInFrom", "city", "depositPct", "id", "logo", "name"]);
  const u = cleanUnit({ id: "u1", structureId: "s1", roomTypeId: "r1", name: "Allegra", serviceDays: ["Lu"], linenFreq: "3 Giorni", campoFuturo: "x", photos: ["a"] });
  assert.deepEqual(Object.keys(u).sort(), ["id", "name", "photos", "roomTypeId", "structureId"]);
});

test("lista bianca e lista nera non si sovrappongono", () => {
  assert.deepEqual(STRUCT_PUBLIC.filter((k) => STRUCT_PRIVATE.includes(k)), []);
  assert.deepEqual(UNIT_PUBLIC.filter((k) => UNIT_PRIVATE.includes(k)), []);
  for (const k of ["iban", "vat", "taxCode", "accessInfo", "stripeAccount", "alloggiatiUser", "gcalId", "pec", "sdi"]) assert.ok(!STRUCT_PUBLIC.includes(k), k);
});
