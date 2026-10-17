import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { maskCovers, MESSAGE_EVENT_MASK } = await import("../src/lib/channex-hooks.ts");
const { parseChannexInquiry, parseChannexMessage } = await import("../src/lib/channex-messages.ts");

test("maschera del webhook messaggi: «message;inquiry», separatore «;»", () => {
  assert.equal(MESSAGE_EVENT_MASK, "message;inquiry");
  assert.equal(maskCovers("message", MESSAGE_EVENT_MASK), false);            // registrato prima: va aggiornato
  assert.equal(maskCovers("message;inquiry", MESSAGE_EVENT_MASK), true);
  assert.equal(maskCovers("inquiry; message", MESSAGE_EVENT_MASK), true);     // ordine e spazi indifferenti
  assert.equal(maskCovers("*", MESSAGE_EVENT_MASK), true);
  assert.equal(maskCovers(undefined, MESSAGE_EVENT_MASK), false);
});

test("evento inquiry (Airbnb): senza testo né booking_id, con message_thread_id", () => {
  const body = { event: "inquiry", property_id: "P1", payload: { status: "new", property_id: "P1", message_thread_id: "T9", live_feed_event_id: "LF1", booking_details: { guest_name: "Anna", checkin_date: "2026-11-02", checkout_date: "2026-11-04", total_guests: 2 } } };
  const inq = parseChannexInquiry(body);
  assert.ok(inq);
  assert.equal(inq!.threadId, "T9");
  assert.equal(inq!.id, "LF1");
  assert.equal(inq!.channel, "Airbnb");
  assert.match(inq!.text, /Anna/);
  assert.equal(parseChannexMessage(body), null); // non è un messaggio di chat
  assert.equal(parseChannexInquiry({ event: "inquiry", payload: {} }), null); // senza property_id
  // senza booking_details resta comunque un avviso valido
  assert.ok(parseChannexInquiry({ event: "inquiry", property_id: "P1", payload: { message_thread_id: "T1" } }));
});
