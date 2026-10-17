import test from "node:test";
import assert from "node:assert/strict";
import { OTA_POLL_MS, OTA_POLL_IDLE_MS, pollVerdict, shouldRefreshOnResume } from "../src/lib/poll-policy.ts";

const base = { now: 1_000_000, lastInteraction: 1_000_000, visible: true, inFlight: 0 };

test("polling OTA: intervallo 60 s e stop dopo 10 minuti", () => {
  assert.equal(OTA_POLL_MS, 60_000);
  assert.equal(OTA_POLL_IDLE_MS, 600_000);
});

test("pollVerdict: pagina visibile, attiva, nessuna richiesta -> poll", () => {
  assert.equal(pollVerdict(base), "poll");
});

test("pollVerdict: pagina nascosta -> skip (nessuna chiamata Channex)", () => {
  assert.equal(pollVerdict({ ...base, visible: false }), "skip");
});

test("pollVerdict: richiesta ancora in corso -> skip (niente sovrapposizioni)", () => {
  assert.equal(pollVerdict({ ...base, inFlight: 1 }), "skip");
});

test("pollVerdict: oltre 10 minuti senza interazione -> stop, anche se nascosta o con richiesta in corso", () => {
  const old = base.now - OTA_POLL_IDLE_MS - 1;
  assert.equal(pollVerdict({ ...base, lastInteraction: old }), "stop");
  assert.equal(pollVerdict({ ...base, lastInteraction: old, visible: false }), "stop");
  assert.equal(pollVerdict({ ...base, lastInteraction: base.now - OTA_POLL_IDLE_MS }), "poll"); // esattamente 10 minuti: ancora attivo
});

test("shouldRefreshOnResume: solo se era fermo, pagina visibile e nessuna richiesta", () => {
  assert.equal(shouldRefreshOnResume({ wasIdle: true, visible: true, inFlight: 0 }), true);
  assert.equal(shouldRefreshOnResume({ wasIdle: false, visible: true, inFlight: 0 }), false);
  assert.equal(shouldRefreshOnResume({ wasIdle: true, visible: false, inFlight: 0 }), false);
  assert.equal(shouldRefreshOnResume({ wasIdle: true, visible: true, inFlight: 1 }), false);
});
