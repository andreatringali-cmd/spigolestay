import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCorrection, signedPct, applyCorrection, breakevenCorrection, validateCorrectionInput, diffCorrections,
  compareRow, summarizeComparison, compareRows, parityAlerts, explainChannexError, canRetry, canRollback,
  logForStructure, correctionLabel, correctionToApi, parseCorrLog,
  type CorrLogEntry, type Correction,
} from "../src/lib/priceCorrection.ts";

const inc = (v: number): Correction => ({ rule: "increase_by_percent", value: v });
const dec = (v: number): Correction => ({ rule: "decrease_by_percent", value: v });

test("parseCorrection: valori Channex (stringhe, virgola) e casi nulli", () => {
  assert.deepEqual(parseCorrection("increase_by_percent", "12.50"), inc(12.5));
  assert.deepEqual(parseCorrection("decrease_by_percent", "5,5"), dec(5.5));
  assert.equal(parseCorrection("increase_by_percent", "0"), null);
  assert.equal(parseCorrection("boh", "5"), null);
  assert.equal(parseCorrection(null, null), null);
});

test("applyCorrection e signedPct", () => {
  assert.equal(signedPct(inc(10)), 10);
  assert.equal(signedPct(dec(10)), -10);
  assert.equal(signedPct(null), 0);
  assert.equal(applyCorrection(100, inc(10)), 110);
  assert.equal(applyCorrection(100, dec(15)), 85);
  assert.equal(applyCorrection(99.99, null), 99.99);
  assert.equal(applyCorrection(80, inc(12.5)), 90);
});

test("pareggio netto: 15% commissione → +17,65%", () => {
  const b = breakevenCorrection(15)!;
  assert.equal(b.rule, "increase_by_percent");
  assert.equal(b.value, 17.65);
  // con la correzione di pareggio il netto ≈ prezzo diretto
  const row = compareRow({ date: "2026-10-10", roomTypeId: "a", roomTypeName: "A", xenora: 100 }, b, 15);
  assert.ok(Math.abs(row.netVsXenoraEur) < 0.05);
  assert.equal(breakevenCorrection(0), null);
  assert.equal(breakevenCorrection(100), null);
});

test("validazione input: errori e avvisi", () => {
  assert.equal(validateCorrectionInput("increase_by_percent", "").ok, true);
  assert.deepEqual((validateCorrectionInput("increase_by_percent", "") as { correction: unknown }).correction, null);
  assert.equal(validateCorrectionInput("increase_by_percent", "abc").ok, false);
  assert.equal(validateCorrectionInput("increase_by_percent", "-5").ok, false);
  assert.equal(validateCorrectionInput("decrease_by_percent", "100").ok, false);
  assert.equal(validateCorrectionInput("increase_by_percent", "101").ok, false);
  assert.equal(validateCorrectionInput("x", "5").ok, false);
  const w = validateCorrectionInput("increase_by_percent", "45");
  assert.equal(w.ok, true);
  assert.ok(w.ok && !!w.warning);
  const r = validateCorrectionInput("decrease_by_percent", "7,256");
  assert.ok(r.ok && r.correction?.value === 7.26);
  const z = validateCorrectionInput("increase_by_percent", "0");
  assert.ok(z.ok && z.correction === null);
});

test("diffCorrections: inversione di segno e variazione grossa", () => {
  const d = diffCorrections(inc(5), dec(8));
  assert.equal(d.signFlip, true);
  assert.equal(d.deltaPoints, -13);
  assert.equal(d.big, true);
  assert.equal(diffCorrections(inc(5), inc(5)).changed, false);
  assert.equal(diffCorrections(null, inc(3)).big, false);
});

test("compareRow: Δ €, Δ %, commissione e netto", () => {
  const r = compareRow({ date: "2026-10-10", roomTypeId: "a", roomTypeName: "A", xenora: 120 }, inc(10), 15);
  assert.equal(r.ota, 132);
  assert.equal(r.deltaEur, 12);
  assert.equal(r.deltaPct, 10);
  assert.equal(r.commissionEur, 19.8);
  assert.equal(r.netOta, 112.2);
  assert.equal(r.netVsXenoraEur, -7.8);
  // prezzo zero → nessuna divisione per zero
  assert.equal(compareRow({ date: "d", roomTypeId: "a", roomTypeName: "A", xenora: 0 }, inc(10), 15).deltaPct, 0);
});

test("summarizeComparison: medie e caso vuoto", () => {
  const rows = compareRows([
    { date: "1", roomTypeId: "a", roomTypeName: "A", xenora: 100 },
    { date: "2", roomTypeId: "a", roomTypeName: "A", xenora: 200 },
  ], inc(10), 0);
  const s = summarizeComparison(rows);
  assert.equal(s.n, 2);
  assert.equal(s.avgXenora, 150);
  assert.equal(s.avgOta, 165);
  assert.equal(summarizeComparison([]).n, 0);
});

test("parityAlerts: undercut e spread oltre soglia, canali inattivi ignorati", () => {
  const ch = (id: string, c: Correction | null, active = true) => ({ id, label: id, correction: c, commissionPct: 15, active });
  const none = parityAlerts([ch("booking", inc(3)), ch("airbnb", inc(4))], 5);
  assert.equal(none.length, 0);
  const under = parityAlerts([ch("booking", dec(8)), ch("airbnb", inc(4))], 5);
  assert.ok(under.some((a) => a.kind === "undercut" && a.channelIds[0] === "booking"));
  assert.ok(under.some((a) => a.kind === "spread"));
  const inactive = parityAlerts([ch("booking", dec(20), false), ch("airbnb", inc(4))], 5);
  assert.equal(inactive.length, 0);
});

test("explainChannexError: messaggi comprensibili per status e JSON", () => {
  assert.match(explainChannexError(0, "CHANNEX_API_KEY non configurata"), /non è configurato/);
  assert.match(explainChannexError(422, JSON.stringify({ details: { hotel_id: ["is required"] } })), /Hotel Id/);
  assert.match(explainChannexError(422, JSON.stringify({ details: { foo: ["bar"] } })), /foo: bar/);
  assert.match(explainChannexError(429), /Troppe richieste/);
  assert.match(explainChannexError(503), /non raggiungibile/);
  assert.match(explainChannexError(404), /non esiste più/);
  assert.match(explainChannexError(0), /Nessuna risposta/);
  assert.match(explainChannexError(401), /accesso/);
  assert.equal(explainChannexError(undefined, ""), "Salvataggio non riuscito.");
});

const entry = (o: Partial<CorrLogEntry>): CorrLogEntry => ({
  id: "e", ts: 1, structureId: "s1", channelId: "c1", channelLabel: "Booking.com", kind: "set",
  from: inc(5), fromKnown: true, to: inc(8), status: "ok", verified: true, ...o,
});

test("storico: ripeti solo fallite non superate, ripristina solo l'ultima ok", () => {
  const fail = entry({ id: "f", ts: 10, status: "error", error: "x" });
  assert.equal(canRetry(fail, [fail]), true);
  const later = entry({ id: "ok2", ts: 20 });
  assert.equal(canRetry(fail, [later, fail]), false);       // c'è una OK più recente sullo stesso canale
  const otherCh = entry({ id: "ok3", ts: 20, channelId: "c2" });
  assert.equal(canRetry(fail, [otherCh, fail]), true);      // altro canale: non conta
  const ok1 = entry({ id: "ok1", ts: 5 });
  assert.equal(canRollback(ok1, [ok1]), true);
  assert.equal(canRollback(ok1, [later, ok1]), false);
  assert.equal(canRollback(entry({ fromKnown: false }), []), false);
  assert.equal(canRollback(entry({ kind: "rollback" }), []), false);
  assert.equal(canRollback(entry({ from: inc(8), to: inc(8) }), []), false);
});

test("indipendenza per struttura: il log si filtra per struttura", () => {
  const all = [entry({ id: "a", structureId: "s1" }), entry({ id: "b", structureId: "s2" })];
  assert.deepEqual(logForStructure(all, "s1").map((e) => e.id), ["a"]);
  assert.deepEqual(logForStructure(all, "s2").map((e) => e.id), ["b"]);
  assert.equal(logForStructure(all, "all").length, 2);
});

test("parseCorrLog robusto e correctionToApi/label", () => {
  assert.deepEqual(parseCorrLog("non json"), []);
  assert.deepEqual(parseCorrLog(null), []);
  assert.equal(parseCorrLog(JSON.stringify([{ id: "x", channelId: "c", ts: 1 }, { foo: 1 }])).length, 1);
  assert.deepEqual(correctionToApi(inc(5)), { rule: "increase_by_percent", value: "5.00" });
  assert.equal(correctionToApi(null), null);
  assert.equal(correctionLabel(dec(2.5)), "−2.5%");
  assert.equal(correctionLabel(null), "nessuna");
});
