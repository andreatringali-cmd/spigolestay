import test from "node:test";
import assert from "node:assert/strict";
import { getAdsConsent, setAdsConsent, loadAdsTag, trackBookingConversion, resolveAdsConfig, adsConfigOf, extractAdsFromText, isValidAdsId, isValidAdsLabel } from "../src/lib/ads.ts";

// Il browser non c'è nei test: si simulano window, localStorage e document quanto basta.
const store = new Map<string, string>();
const calls: unknown[][] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.window = { dataLayer: undefined as unknown, gtag: undefined as unknown };
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
g.document = { head: { appendChild: () => {} }, createElement: () => ({}) };

const A = { id: "AW-111111111", label: "AAAAAAAAAAAAA" };
const B = { id: "AW-222222222", label: "BBBBBBBBBBBBB" };

test("ID e etichetta validi / non validi", () => {
  assert.equal(isValidAdsId("AW-18509493463"), true);
  for (const bad of ["", "AW-", "AW-12", "G-ABC123", "aw-123456789", "AW-1234567890123456", undefined]) assert.equal(isValidAdsId(bad), false, String(bad));
  assert.equal(isValidAdsLabel("cx6hCPOAmpsdENfpgfpE"), true);
  for (const bad of ["", "corta", "con spazi e simboli!!", "x".repeat(41)]) assert.equal(isValidAdsLabel(bad), false, bad);
});

test("configurazione dalla struttura: ID obbligatorio, etichetta facoltativa", () => {
  assert.deepEqual(adsConfigOf({ googleAdsId: " AW-111111111 ", googleAdsLabel: "AAAAAAAAAAAAA" }), A);
  assert.deepEqual(adsConfigOf({ googleAdsId: "AW-111111111" }), { id: "AW-111111111", label: "" });
  assert.deepEqual(adsConfigOf({ googleAdsId: "AW-111111111", googleAdsLabel: "no!" }), { id: "AW-111111111", label: "" });
  assert.equal(adsConfigOf({ googleAdsId: "boh" }), null);
  assert.equal(adsConfigOf(undefined), null);
});

test("quale account vale per un sito: quello della struttura, poi i valori storici di Spigolehouse, altrimenti nessuno", () => {
  assert.deepEqual(resolveAdsConfig("altro-cliente", [{ googleAdsId: A.id, googleAdsLabel: A.label }]), A, "impostato sulla struttura");
  assert.deepEqual(resolveAdsConfig("spigolehouse", [{ googleAdsId: B.id, googleAdsLabel: B.label }]), B, "la struttura vince sui valori storici");
  for (const slug of ["spigolehouse", "Spigolerooms", "central-perk"]) assert.equal(resolveAdsConfig(slug, [{}])?.id, "AW-18509493463", slug);
  for (const slug of ["altro-cliente", "", null, undefined]) assert.equal(resolveAdsConfig(slug, [{}]), null, String(slug));
});

test("incollando il codice di Google si leggono ID ed etichetta", () => {
  assert.deepEqual(extractAdsFromText("gtag('config', 'AW-18509493463');"), { id: "AW-18509493463" });
  assert.deepEqual(extractAdsFromText("'send_to': 'AW-18509493463/cx6hCPOAmpsdENfpgfpE',"), { id: "AW-18509493463", label: "cx6hCPOAmpsdENfpgfpE" });
  assert.deepEqual(extractAdsFromText("cx6hCPOAmpsdENfpgfpE"), { label: "cx6hCPOAmpsdENfpgfpE" });
  assert.deepEqual(extractAdsFromText("boh"), {});
});

test("senza scelta non c'è consenso e non si invia nulla; rifiuto e consenso si ricordano", () => {
  assert.equal(getAdsConsent(), null);
  assert.equal(trackBookingConversion(A, { value: 100, transactionId: "XEN-1" }), false);
  setAdsConsent("denied"); assert.equal(getAdsConsent(), "denied");
  setAdsConsent("granted"); assert.equal(getAdsConsent(), "granted");
});

test("il tag si carica una volta sola e si configura per ogni account", () => {
  loadAdsTag(A); loadAdsTag(A); loadAdsTag(B);
  const w = g.window as { dataLayer: unknown[][]; gtag?: unknown };
  assert.equal(typeof w.gtag, "function");
  const cfg = w.dataLayer.filter((a) => (a as unknown[])[0] === "config").map((a) => (a as unknown[])[1]);
  assert.deepEqual(cfg, [A.id, B.id]);
});

test("conversione: una sola volta per codice, verso l'account e l'etichetta della struttura", () => {
  const w = g.window as { gtag: (...a: unknown[]) => void };
  const orig = w.gtag; w.gtag = (...a: unknown[]) => { calls.push(a); orig(...a); };
  assert.equal(trackBookingConversion(A, { value: 123.456, transactionId: "XEN-2" }), true);
  assert.equal(trackBookingConversion(A, { value: 123.456, transactionId: "XEN-2" }), false, "stesso codice: niente doppione");
  assert.deepEqual(calls[0], ["event", "conversion", { send_to: "AW-111111111/AAAAAAAAAAAAA", value: 123.46, currency: "EUR", transaction_id: "XEN-2" }]);
  assert.equal(trackBookingConversion(B, { value: 80, transactionId: "XEN-2" }), true, "stesso codice ma altro account: parte");
  assert.equal(trackBookingConversion(A, { value: 80, transactionId: "XEN-3" }), true);
  assert.equal(calls.length, 3);
});

test("senza account, senza etichetta o senza consenso non parte nulla", () => {
  const before = calls.length;
  assert.equal(trackBookingConversion(null, { value: 50, transactionId: "X-1" }), false);
  assert.equal(trackBookingConversion({ id: A.id, label: "" }, { value: 50, transactionId: "X-2" }), false);
  setAdsConsent("denied");
  assert.equal(trackBookingConversion(A, { value: 50, transactionId: "X-3" }), false);
  assert.equal(calls.length, before);
});

test("conversione già inviata con la vecchia chiave (prima delle impostazioni per struttura) non si rimanda", () => {
  setAdsConsent("granted");
  store.set("xn-ads-conv:SPG-2026-2728", "1");
  assert.equal(trackBookingConversion({ id: "AW-18509493463", label: "cx6hCPOAmpsdENfpgfpE" }, { value: 80, transactionId: "SPG-2026-2728" }), false);
});
