import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOtaActionInput, otaActionRequest, canReportToOta, channexBookingIdFromExtId, windowHint, otaLogLine, OTA_ACTION_INFO,
} from "../src/lib/channex-booking-actions.ts";

const ID = "6f1c2b8e-1111-4222-8333-444455556666";

test("parseOtaActionInput: accetta solo azione nota + id + parola di conferma esatta", () => {
  const ok = parseOtaActionInput({ bookingId: ID, action: "no_show", confirm: "NOSHOW" });
  assert.equal(ok.ok, true);
  assert.deepEqual(parseOtaActionInput({ bookingId: ID, action: "refund", confirm: "NOSHOW" }), { ok: false, error: "azione_non_valida" });
  assert.deepEqual(parseOtaActionInput({ bookingId: "x", action: "no_show", confirm: "NOSHOW" }), { ok: false, error: "bookingId_non_valido" });
  assert.deepEqual(parseOtaActionInput({ bookingId: "../../x/../y", action: "no_show", confirm: "NOSHOW" }), { ok: false, error: "bookingId_non_valido" });
  assert.deepEqual(parseOtaActionInput({ bookingId: ID, action: "no_show", confirm: "noshow" }), { ok: false, error: "conferma_mancante" });
  assert.deepEqual(parseOtaActionInput({ bookingId: ID, action: "cancel_invalid_card", confirm: "CARTA" }), { ok: false, error: "conferma_mancante" });
  assert.deepEqual(parseOtaActionInput({ bookingId: ID, action: "cancel_invalid_card" }), { ok: false, error: "conferma_mancante" });
  assert.equal(parseOtaActionInput(null).ok, false);
  assert.equal(parseOtaActionInput("no_show").ok, false);
});

test("otaActionRequest: percorsi e corpi come da documentazione Channex", () => {
  assert.deepEqual(otaActionRequest("no_show", ID), { path: `/bookings/${ID}/no_show`, body: '{"no_show_report":{"waived_fees":false}}' });
  assert.deepEqual(otaActionRequest("no_show_waived", ID), { path: `/bookings/${ID}/no_show`, body: '{"no_show_report":{"waived_fees":true}}' });
  assert.deepEqual(otaActionRequest("invalid_card", ID), { path: `/bookings/${ID}/invalid_card`, body: undefined });
  assert.deepEqual(otaActionRequest("cancel_invalid_card", ID), { path: `/bookings/${ID}/cancel_due_invalid_card`, body: undefined });
});

test("canReportToOta: solo Booking.com importato da Channex e non annullato", () => {
  assert.equal(canReportToOta({ channel: "booking", extId: `channex:${ID}`, status: "confirmed" }), true);
  assert.equal(canReportToOta({ channel: "expedia", extId: `channex:${ID}`, status: "confirmed" }), false);
  assert.equal(canReportToOta({ channel: "airbnb", extId: `channex:${ID}`, status: "confirmed" }), false);
  assert.equal(canReportToOta({ channel: "booking", extId: "ical:abc", status: "confirmed" }), false);
  assert.equal(canReportToOta({ channel: "booking", extId: undefined, status: "confirmed" }), false);
  assert.equal(canReportToOta({ channel: "booking", extId: `channex:${ID}`, status: "cancelled" }), false);
  assert.equal(channexBookingIdFromExtId("channex:"), null);
});

test("le parole di conferma sono distinte per le azioni di effetto diverso", () => {
  assert.notEqual(OTA_ACTION_INFO.invalid_card.confirmWord, OTA_ACTION_INFO.cancel_invalid_card.confirmWord);
  assert.notEqual(OTA_ACTION_INFO.no_show.confirmWord, OTA_ACTION_INFO.cancel_invalid_card.confirmWord);
});

test("windowHint: suggerimenti non bloccanti sulla finestra", () => {
  assert.match(windowHint("no_show", "2026-10-12", "2026-10-10")!, /futuro/);
  assert.equal(windowHint("no_show", "2026-10-10", "2026-10-10"), null);
  assert.match(windowHint("no_show", "2026-10-05", "2026-10-10")!, /48 ore/);
  assert.match(windowHint("invalid_card", "2026-10-10", "2026-10-10")!, /mezzanotte/);
  assert.equal(windowHint("invalid_card", "2026-10-12", "2026-10-10"), null);
});

test("otaLogLine: registra esito riuscito e fallito", () => {
  assert.equal(otaLogLine("no_show", true, "2026-10-10T08:30:00.000Z"), "[2026-10-10 08:30] no-show segnalato a Booking.com.");
  assert.match(otaLogLine("invalid_card", false, "2026-10-10T08:30:00.000Z", "422"), /TENTATIVO FALLITO.*422/);
});
