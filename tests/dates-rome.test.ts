import { test } from "node:test";
import assert from "node:assert/strict";
import { todayRome, ymdRome, addDaysYmd } from "../src/lib/dates-rome.ts";

test("todayRome: tra mezzanotte e le 2 italiane il giorno e' gia' quello nuovo (ora legale, UTC+2)", () => {
  // 2026-07-14 22:30 UTC = 2026-07-15 00:30 a Roma
  assert.equal(todayRome(new Date("2026-07-14T22:30:00Z")), "2026-07-15");
  // 2026-07-14 21:59 UTC = 23:59 a Roma: ancora il 14
  assert.equal(todayRome(new Date("2026-07-14T21:59:00Z")), "2026-07-14");
  assert.equal(todayRome(new Date("2026-07-14T22:00:00Z")), "2026-07-15");
});

test("todayRome: ora solare (UTC+1)", () => {
  // 2026-01-14 23:30 UTC = 2026-01-15 00:30 a Roma
  assert.equal(todayRome(new Date("2026-01-14T23:30:00Z")), "2026-01-15");
  assert.equal(todayRome(new Date("2026-01-14T22:59:00Z")), "2026-01-14");
});

test("cambio ora legale: 29 marzo 2026 (01:00 UTC passa da +1 a +2)", () => {
  assert.equal(ymdRome(new Date("2026-03-28T22:59:00Z")), "2026-03-28"); // 23:59 CET
  assert.equal(ymdRome(new Date("2026-03-28T23:00:00Z")), "2026-03-29"); // 00:00 CET
  assert.equal(ymdRome(new Date("2026-03-29T21:59:00Z")), "2026-03-29"); // 23:59 CEST
  assert.equal(ymdRome(new Date("2026-03-29T22:00:00Z")), "2026-03-30"); // 00:00 CEST
});

test("cambio ora solare: 25 ottobre 2026 (01:00 UTC passa da +2 a +1)", () => {
  assert.equal(ymdRome(new Date("2026-10-24T21:59:00Z")), "2026-10-24"); // 23:59 CEST
  assert.equal(ymdRome(new Date("2026-10-24T22:00:00Z")), "2026-10-25"); // 00:00 CEST
  assert.equal(ymdRome(new Date("2026-10-25T22:59:00Z")), "2026-10-25"); // 23:59 CET
  assert.equal(ymdRome(new Date("2026-10-25T23:00:00Z")), "2026-10-26"); // 00:00 CET
});

test("ymdRome: capodanno e input numerico/stringa", () => {
  assert.equal(ymdRome(new Date("2026-12-31T23:00:00Z")), "2027-01-01");
  assert.equal(ymdRome(Date.parse("2026-06-01T12:00:00Z")), "2026-06-01");
  assert.equal(ymdRome("2026-06-01T23:30:00Z"), "2026-06-02");
  assert.throws(() => ymdRome("non-una-data"));
});

test("addDaysYmd: aritmetica di calendario", () => {
  assert.equal(addDaysYmd("2026-03-01", -7), "2026-02-22");
  assert.equal(addDaysYmd("2026-03-25", 7), "2026-04-01");
  assert.equal(addDaysYmd("2026-10-24", 1), "2026-10-25");
  assert.equal(addDaysYmd("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysYmd("2028-02-28", 1), "2028-02-29");
});
