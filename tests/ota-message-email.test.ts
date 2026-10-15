import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { appendOtaMessage, otaMessageEmailText } = await import("../src/lib/channex-messages.ts");

const data = {
  structures: [{ id: "s1", name: "Spigolehouse" }],
  roomTypes: [{ id: "rt1", name: "Deluxe" }],
  guests: [{ id: "g1", fullName: "Hanna  Lowthion" }],
  bookings: [{ id: "b1", extId: "channex:ext1", guestId: "g1", channel: "booking", code: "XEN-2026-0042", checkIn: "2026-10-16", checkOut: "2026-10-18", adults: 2, children: 0, structureId: "s1", roomTypeId: "rt1" }],
};
const msg = { id: "m1", bookingId: "ext1", propertyId: "p1", text: "Hello", sender: "guest" } as never;

test("messaggio OTA: l'avviso porta nome ospite, struttura, date e codice della prenotazione", () => {
  const blob: Record<string, string> = { "spigolestay:data:v1": JSON.stringify(data) };
  const res = appendOtaMessage(blob, msg, 1_000);
  assert.equal(res.status, "added");
  if (res.status !== "added") return;
  assert.equal(res.details.guestName, "Hanna Lowthion");
  assert.equal(res.details.structureName, "Spigolehouse");
  assert.equal(res.details.nights, 2);
  const text = otaMessageEmailText(res.channel, "Hello", res.details, "https://xenora.it/messaggi");
  assert.match(text, /^Hanna Lowthion ti ha scritto su /);
  assert.match(text, /Struttura: Spigolehouse · Deluxe/);
  assert.match(text, /16\.10\.2026 → 18\.10\.2026 \(2 notti\) · 2 adulti/);
  assert.match(text, /Prenotazione: XEN-2026-0042/);
});

test("messaggio OTA: la prenotazione nei dati di un'organizzazione condivisa dà gli stessi dettagli", () => {
  const res = appendOtaMessage({}, msg, 1_000, [data]);
  assert.equal(res.status, "added");
  if (res.status === "added") assert.equal(res.details.roomTypeName, "Deluxe");
});

test("messaggio OTA: senza dettagli l'avviso resta leggibile", () => {
  const text = otaMessageEmailText("Booking.com", "Hello", { guestName: "", structureName: "", roomTypeName: "", checkIn: "", checkOut: "", nights: 0, adults: 0, children: 0, code: "" }, "u");
  assert.match(text, /^Un ospite ti ha scritto su Booking\.com:/);
  assert.doesNotMatch(text, /Struttura:|Soggiorno:|Prenotazione:/);
});
