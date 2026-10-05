import { test } from "node:test";
import assert from "node:assert/strict";
import { channelPulse, type PulseBooking } from "../src/lib/channel-pulse.ts";

const TODAY = "2026-10-06";
const day = (n: number) => new Date(Date.parse(TODAY + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);
// n prenotazioni per ciascun giorno indicato
const make = (channel: string, perDay: Record<number, number>): PulseBooking[] =>
  Object.entries(perDay).flatMap(([d, n]) => Array.from({ length: n }, () => ({ channel, bookedOn: day(Number(d)) })));
const labels = { booking: "Booking.com", airbnb: "Airbnb" };

test("regolare: andamento in linea con la media", () => {
  // 28 giorni precedenti: 12 prenotazioni (3 a settimana); ultimi 7 giorni: 3
  const b = make("booking", { 2: 1, 4: 1, 6: 1, 9: 3, 16: 3, 23: 3, 30: 3 });
  const p = channelPulse({ bookings: b, today: TODAY, labels })[0];
  assert.equal(p.level, "ok"); assert.equal(p.recent, 3); assert.equal(p.baselineWeekly, 3);
});

test("calo forte: 1 negli ultimi 7 giorni contro media 6 a settimana → errore con percentuale", () => {
  const b = make("booking", { 3: 1, 10: 6, 17: 6, 24: 6, 31: 6 });
  const p = channelPulse({ bookings: b, today: TODAY, labels })[0];
  assert.equal(p.level, "err"); assert.equal(p.headline, "In calo -83%");
});

test("calo moderato: avviso, non errore", () => {
  const b = make("booking", { 2: 2, 10: 4, 17: 4, 24: 4, 31: 4 }); // 2 contro 4 = -50%
  const p = channelPulse({ bookings: b, today: TODAY, labels })[0];
  assert.equal(p.level, "warn");
});

test("numeri troppo piccoli: nessun falso allarme", () => {
  const b = make("airbnb", { 20: 1, 27: 1, 33: 1 }); // media 0,75 a settimana, 0 negli ultimi 7 giorni
  const p = channelPulse({ bookings: b, today: TODAY, labels })[0];
  assert.notEqual(p.level, "err"); assert.notEqual(p.level, "warn");
});

test("silenzio: di solito una ogni 6 giorni circa, ora nulla da 16 giorni", () => {
  const b = make("booking", { 16: 2, 20: 2, 25: 2, 30: 2, 40: 2, 50: 2, 60: 2 });
  const p = channelPulse({ bookings: b, today: TODAY, labels })[0];
  assert.equal(p.level, "warn"); assert.match(p.headline, /Nessuna prenotazione da 16 giorni/);
});

test("canale scollegato: errore, anche se in passato andava bene", () => {
  const b = make("booking", { 2: 1, 10: 3 });
  const p = channelPulse({ bookings: b, today: TODAY, connected: { booking: false }, labels })[0];
  assert.equal(p.level, "err"); assert.equal(p.headline, "Non collegato");
});

test("sincronizzazione ferma da più di 48 ore", () => {
  const b = make("booking", { 2: 1, 10: 3 });
  const p = channelPulse({ bookings: b, today: TODAY, connected: { booking: true }, lastSyncHours: { booking: 73 }, labels })[0];
  assert.equal(p.level, "warn"); assert.match(p.detail, /73 ore/);
});

test("crescita segnalata come informazione", () => {
  const b = make("booking", { 1: 3, 2: 3, 10: 3, 17: 3, 24: 3, 31: 3 }); // 6 contro media 3
  const p = channelPulse({ bookings: b, today: TODAY, labels })[0];
  assert.equal(p.level, "info"); assert.match(p.headline, /In crescita \+100%/);
});

test("ordine: prima i problemi gravi; le prenotazioni bloccate e senza data non contano", () => {
  const b = [...make("booking", { 3: 1, 10: 6, 17: 6, 24: 6, 31: 6 }), ...make("airbnb", { 2: 1, 4: 1, 6: 1, 9: 3, 16: 3, 23: 3, 30: 3 }), { channel: "blocked", bookedOn: day(1) }, { channel: "booking" }];
  const out = channelPulse({ bookings: b, today: TODAY, labels });
  assert.deepEqual(out.map((p) => p.channel), ["booking", "airbnb"]);
  assert.equal(out.find((p) => p.channel === "blocked"), undefined);
});
