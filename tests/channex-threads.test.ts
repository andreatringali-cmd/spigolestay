import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const T = await import("../src/lib/channex-threads.ts");

const row = (o: Record<string, unknown> = {}) => ({ id: "t1", type: "message_thread", attributes: { title: "Hanna Lowthion", is_closed: false, provider: "BookingCom", message_count: 7, last_message: "Is there any update?", last_message_received_at: "2026-10-16T08:00:00Z", inserted_at: "2026-10-10T08:00:00Z" }, relationships: { booking: { data: { id: "b1", type: "booking" } }, property: { data: { id: "p1" } } }, ...o });

test("normalizeThread: campi, booking e property dalle relazioni", () => {
  const t = T.normalizeThread(row())!;
  assert.deepEqual([t.id, t.title, t.provider, t.closed, t.count, t.bookingId, t.propertyId], ["t1", "Hanna Lowthion", "BookingCom", false, 7, "b1", "p1"]);
  assert.equal(t.lastMessage, "Is there any update?");
  assert.equal(t.lastAt, Date.parse("2026-10-16T08:00:00Z"));
});
test("normalizeThread: senza prenotazione (richiesta di informazioni) e righe sporche", () => {
  const t = T.normalizeThread(row({ relationships: { property: { data: { id: "p1" } } } }))!;
  assert.equal(t.bookingId, "");
  assert.equal(T.normalizeThread(null), null);
  assert.equal(T.normalizeThread({ attributes: {} }), null);
  assert.equal(T.normalizeThread({ id: "x", attributes: { message_count: "boh", is_closed: "true" } })!.closed, false);
});
test("normalizeMessage: mittente ospite/struttura/sistema e orario", () => {
  const toUrl = () => [];
  const m = (sender: unknown) => T.normalizeMessage({ id: "m", attributes: { message: "Ciao", sender, inserted_at: "2026-10-16T09:00:00Z" } }, toUrl)!;
  assert.equal(m("guest").sender, "guest"); assert.equal(m("property").sender, "property"); assert.equal(m("system").sender, "system"); assert.equal(m(undefined).sender, "property");
  assert.equal(m("guest").ts, Date.parse("2026-10-16T09:00:00Z"));
  assert.equal(T.normalizeMessage({ attributes: { message: "x" } }, toUrl), null);
});
test("providerChannel/Label e 'Non è richiesta una risposta' solo per Booking.com", () => {
  assert.equal(T.providerChannel("BookingCom"), "booking"); assert.equal(T.providerChannel("Airbnb"), "airbnb"); assert.equal(T.providerChannel("Expedia"), "expedia"); assert.equal(T.providerChannel("Altro"), "other");
  assert.equal(T.providerLabel("BookingCom"), "Booking.com");
  assert.equal(T.noReplySupported("BookingCom"), true); assert.equal(T.noReplySupported("Airbnb"), false);
});
test("threadAllowed: solo le property dell'utente (account Channex condiviso tra clienti)", () => {
  const allowed = new Set(["p1"]);
  assert.equal(T.threadAllowed({ propertyId: "p1" }, allowed), true);
  assert.equal(T.threadAllowed({ propertyId: "p2" }, allowed), false);
  assert.equal(T.threadAllowed({ propertyId: "" }, allowed), false);
});
test("mergeThreads: senza doppioni, dalla più recente; ago in italiano", () => {
  const a = { ...T.normalizeThread(row())!, id: "a", lastAt: 100 }, b = { ...a, id: "b", lastAt: 300 }, a2 = { ...a, lastAt: 200 };
  assert.deepEqual(T.mergeThreads([[a, b], [a2]]).map((t: { id: string; lastAt: number }) => `${t.id}:${t.lastAt}`), ["b:300", "a:200"]);
  const now = Date.parse("2026-10-17T12:00:00Z");
  assert.equal(T.ago(now - 13 * 3600e3, now), "13 ore fa"); assert.equal(T.ago(now - 3 * 86400e3, now), "3 giorni fa"); assert.equal(T.ago(now - 5e3, now), "adesso"); assert.equal(T.ago(0, now), "");
});
