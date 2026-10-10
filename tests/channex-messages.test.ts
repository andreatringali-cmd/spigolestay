import test from "node:test";
import assert from "node:assert/strict";
import { isOffHours, otaAutoActive } from "../src/lib/aiConcierge.ts";
import { parseChannexMessage, appendOtaMessage, otaLabel, messageHookSecret, bookingHookSecret, verifyMessageHook, verifyBookingHook } from "../src/lib/channex-messages.ts";

const ev = (over: Record<string, unknown> = {}) => ({ event: "message", property_id: "P1", payload: { id: "m1", message: " Ciao ", sender: "guest", booking_id: "B1", property_id: "P1", ...over } });

test("parseChannexMessage: messaggio dell'ospite", () => {
  assert.deepEqual(parseChannexMessage(ev()), { id: "m1", text: "Ciao", bookingId: "B1", propertyId: "P1" });
});
test("parseChannexMessage: scarta risposte della struttura, altri eventi e dati incompleti", () => {
  assert.equal(parseChannexMessage(ev({ sender: "property" })), null);
  assert.equal(parseChannexMessage({ ...ev(), event: "booking" }), null);
  assert.equal(parseChannexMessage(ev({ booking_id: "" })), null);
  assert.equal(parseChannexMessage(ev({ message: "  " })), null);
  assert.equal(parseChannexMessage(null), null);
});
test("parseChannexMessage: solo allegato → testo segnaposto", () => {
  assert.match(parseChannexMessage(ev({ message: "", have_attachment: true }))!.text, /Allegato/);
});
test("appendOtaMessage: aggiunge al thread dell'ospite e non duplica", () => {
  const blob: Record<string, string> = {
    "spigolestay:data:v1": JSON.stringify({ bookings: [{ id: "bk1", extId: "channex:B1", guestId: "G1", channel: "booking" }] }),
    "spigolestay:threads:v1": JSON.stringify({ G1: [{ id: "x", dir: "out", text: "hi", ts: 1 }] }),
  };
  const msg = { id: "m1", text: "Ciao", bookingId: "B1", propertyId: "P1" };
  assert.deepEqual(appendOtaMessage(blob, msg, 1000), { status: "added", guestId: "G1", bookingId: "bk1", channel: "Booking.com" });
  const t = JSON.parse(blob["spigolestay:threads:v1"]);
  assert.equal(t.G1.length, 2);
  assert.deepEqual(t.G1[1], { id: "chx:m1", dir: "in", text: "Ciao", ts: 1000, via: "Booking.com" });
  assert.equal(appendOtaMessage(blob, msg, 2000).status, "duplicate");
  assert.equal(JSON.parse(blob["spigolestay:threads:v1"]).G1.length, 2);
});
test("appendOtaMessage: prenotazione sconosciuta", () => {
  assert.equal(appendOtaMessage({}, { id: "m", text: "t", bookingId: "B9", propertyId: "P" }, 1).status, "no_booking");
});
test("otaLabel e segreto", () => {
  assert.equal(otaLabel("airbnb"), "Airbnb");
  assert.equal(otaLabel("expedia"), "Expedia");
  assert.equal(otaLabel(undefined), "OTA");
  assert.equal(messageHookSecret({}), "");
  assert.equal(messageHookSecret({ CRON_SECRET: "a" }), messageHookSecret({ CRON_SECRET: "a" }));
  assert.notEqual(messageHookSecret({ CRON_SECRET: "a" }), messageHookSecret({ CRON_SECRET: "b" }));
});

test("fascia fuori orario: ora italiana, anche a cavallo della mezzanotte", () => {
  const at = (iso: string) => new Date(iso); // ottobre: Roma = UTC+2
  assert.equal(isOffHours(at("2026-10-07T20:00:00Z"), 21, 9), true); // 22:00 a Roma
  assert.equal(isOffHours(at("2026-10-07T03:00:00Z"), 21, 9), true); // 05:00
  assert.equal(isOffHours(at("2026-10-07T08:00:00Z"), 21, 9), false); // 10:00
  assert.equal(isOffHours(at("2026-10-07T10:00:00Z"), 12, 14), true); // 12:00, fascia senza mezzanotte
  assert.equal(isOffHours(at("2026-10-07T20:00:00Z"), 9, 9), false);
});
test("otaAutoActive: serve il Concierge acceso e la modalità giusta", () => {
  const night = new Date("2026-10-07T20:00:00Z"), day = new Date("2026-10-07T08:00:00Z");
  const p = { enabled: true, otaMode: "offhours" as const, otaFrom: 21, otaTo: 9 };
  assert.equal(otaAutoActive(p, night), true);
  assert.equal(otaAutoActive(p, day), false);
  assert.equal(otaAutoActive({ ...p, otaMode: "always" }, day), true);
  assert.equal(otaAutoActive({ ...p, otaMode: "off" }, night), false);
  assert.equal(otaAutoActive({ ...p, enabled: false, otaMode: "always" }, night), false);
});

test("segreti webhook: stessa base, etichette diverse (non intercambiabili)", () => {
  const env = { CRON_SECRET: "abc" };
  assert.equal(bookingHookSecret({}), "");
  assert.equal(bookingHookSecret(env), bookingHookSecret({ CRON_SECRET: "abc" }));
  assert.notEqual(bookingHookSecret(env), messageHookSecret(env));
  assert.equal(bookingHookSecret({ CRED_SECRET: "abc" }), bookingHookSecret(env)); // ripiego su CRED_SECRET
});

test("verifyMessageHook: fallisce in chiusura in produzione senza segreto, in locale no", () => {
  assert.deepEqual(verifyMessageHook(null, { NODE_ENV: "production" }), { accept: false, reason: "no_secret_prod" });
  assert.deepEqual(verifyMessageHook("x", { VERCEL_ENV: "production" }), { accept: false, reason: "no_secret_prod" });
  assert.deepEqual(verifyMessageHook(null, { NODE_ENV: "development" }), { accept: true, reason: "no_secret_dev" });
  assert.deepEqual(verifyMessageHook(undefined, {}), { accept: true, reason: "no_secret_dev" });
});
test("verifyMessageHook: con segreto configurato serve quello giusto", () => {
  const env = { CRON_SECRET: "abc", NODE_ENV: "production" };
  const good = messageHookSecret(env);
  assert.equal(verifyMessageHook(good, env).accept, true);
  assert.deepEqual(verifyMessageHook(null, env), { accept: false, reason: "bad_secret" });
  assert.deepEqual(verifyMessageHook("sbagliato", env), { accept: false, reason: "bad_secret" });
  assert.equal(verifyMessageHook(bookingHookSecret(env), env).accept, false); // il segreto delle prenotazioni non vale per i messaggi
  assert.equal(verifyMessageHook(good, { ...env, NODE_ENV: "development" }).accept, true);
});

test("verifyBookingHook: retrocompatibile senza STRICT, rifiuta segreti sbagliati", () => {
  const env = { CRON_SECRET: "abc", NODE_ENV: "production" };
  const good = bookingHookSecret(env);
  assert.deepEqual(verifyBookingHook(good, env), { accept: true, reason: "ok" });
  assert.deepEqual(verifyBookingHook(null, env), { accept: true, reason: "missing_secret_legacy" }); // webhook già registrati, senza intestazione
  assert.deepEqual(verifyBookingHook("", env), { accept: true, reason: "missing_secret_legacy" });
  assert.deepEqual(verifyBookingHook("sbagliato", env), { accept: false, reason: "bad_secret" });
  assert.deepEqual(verifyBookingHook(messageHookSecret(env), env), { accept: false, reason: "bad_secret" });
  assert.deepEqual(verifyBookingHook(null, {}), { accept: true, reason: "no_secret_legacy" }); // nessun segreto configurato: come prima
});
test("verifyBookingHook: con CHANNEX_WEBHOOK_STRICT=1 serve il segreto", () => {
  const env = { CRON_SECRET: "abc", CHANNEX_WEBHOOK_STRICT: "1" };
  assert.equal(verifyBookingHook(bookingHookSecret(env), env).accept, true);
  assert.deepEqual(verifyBookingHook(null, env), { accept: false, reason: "missing_secret_strict" });
  assert.equal(verifyBookingHook("sbagliato", env).accept, false);
  assert.equal(verifyBookingHook(null, { CHANNEX_WEBHOOK_STRICT: "1" }).accept, false); // strict ma segreto non configurato
  assert.equal(verifyBookingHook(null, { CRON_SECRET: "abc", CHANNEX_WEBHOOK_STRICT: "0" }).accept, true);
});
