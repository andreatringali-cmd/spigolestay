import test from "node:test";
import assert from "node:assert/strict";
import { getAdsConsent, setAdsConsent, loadAdsTag, trackBookingConversion, ADS_ID } from "../src/lib/ads.ts";

// Il browser non c'è nei test: si simulano window, localStorage e document quanto basta.
const store = new Map<string, string>();
const calls: unknown[][] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.window = { dataLayer: undefined as unknown, gtag: undefined as unknown };
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
g.document = { head: { appendChild: () => {} }, createElement: () => ({}) };

test("senza scelta non c'è consenso e non si carica né si invia nulla", () => {
  assert.equal(getAdsConsent(), null);
  assert.equal(trackBookingConversion({ value: 100, transactionId: "XEN-1" }), false);
});

test("il rifiuto e il consenso si ricordano", () => {
  setAdsConsent("denied"); assert.equal(getAdsConsent(), "denied");
  setAdsConsent("granted"); assert.equal(getAdsConsent(), "granted");
});

test("con consenso il tag si carica una volta sola con l'ID dell'account", () => {
  loadAdsTag(); loadAdsTag();
  const w = g.window as { dataLayer: unknown[][]; gtag?: unknown };
  assert.equal(typeof w.gtag, "function");
  const cfg = w.dataLayer.filter((a) => (a as unknown[])[0] === "config");
  assert.equal(cfg.length, 1);
  assert.equal((cfg[0] as unknown[])[1], ADS_ID);
});

test("senza etichetta di conversione (ancora vuota) non parte nessuna conversione", () => {
  const w = g.window as { gtag: (...a: unknown[]) => void };
  const orig = w.gtag; w.gtag = (...a: unknown[]) => { calls.push(a); orig(...a); };
  assert.equal(trackBookingConversion({ value: 100, transactionId: "XEN-2" }), false);
  assert.equal(calls.length, 0);
});
