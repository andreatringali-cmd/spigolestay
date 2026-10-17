import test from "node:test";
import assert from "node:assert/strict";
import { windowOpenFrom } from "../src/lib/wa-window.ts";

test("finestra WhatsApp: aperta solo se l'ospite ha scritto nelle ultime 24 ore", () => {
  const now = Date.parse("2026-10-11T20:00:00Z");
  const th = { g1: [{ dir: "in", ts: now - 2 * 3600 * 1000 }], g2: [{ dir: "in", ts: now - 30 * 3600 * 1000 }], g3: [{ dir: "out", ts: now - 1000 }] };
  assert.equal(windowOpenFrom(th, "g1", now), true);    // ha scritto 2 ore fa
  assert.equal(windowOpenFrom(th, "g2", now), false);   // 30 ore fa: chiusa
  assert.equal(windowOpenFrom(th, "g3", now), false);   // solo messaggi in uscita
  assert.equal(windowOpenFrom(th, "nessuno", now), false);
});

test("finestra WhatsApp: i messaggi importati da Booking/Airbnb (id chx:) non la aprono", () => {
  const now = Date.parse("2026-10-11T20:00:00Z");
  const th = {
    ota: [{ id: "chx:abc", dir: "in", ts: now - 1000 }],
    mix: [{ id: "chx:abc", dir: "in", ts: now - 1000 }, { id: "wamid.XYZ", dir: "in", ts: now - 3600 * 1000 }],
    vecchio: [{ id: "chx:abc", dir: "in", ts: now - 1000 }, { id: "wamid.XYZ", dir: "in", ts: now - 30 * 3600 * 1000 }],
  };
  assert.equal(windowOpenFrom(th, "ota", now), false);
  assert.equal(windowOpenFrom(th, "mix", now), true);      // un messaggio vero su WhatsApp 1 ora fa
  assert.equal(windowOpenFrom(th, "vecchio", now), false); // l'unico WhatsApp è vecchio
});
