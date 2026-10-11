import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingErrorMessage, BOOKING_NETWORK_ERROR } from "../src/lib/booking-errors.ts";

test("409 / no_availability: spiega che le date non sono più disponibili", () => {
  assert.match(bookingErrorMessage(409, "no_availability"), /non sono più disponibili/);
  assert.match(bookingErrorMessage(409), /non sono più disponibili/);
});
test("429: invita ad attendere", () => {
  assert.match(bookingErrorMessage(429, "troppe_richieste"), /Troppi tentativi/);
});
test("400 con codici noti e generico", () => {
  assert.match(bookingErrorMessage(400, "bad_dates"), /date/);
  assert.match(bookingErrorMessage(400, "price_mismatch"), /prezzo/);
  assert.match(bookingErrorMessage(500, "server_error"), /Non è stato possibile completare/);
  assert.match(bookingErrorMessage(404, "site_not_found"), /non accetta prenotazioni/);
});
test("errore di rete: messaggio dedicato", () => {
  assert.match(BOOKING_NETWORK_ERROR, /non è stata registrata/);
});
