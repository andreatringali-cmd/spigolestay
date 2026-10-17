import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { explainSuggestion } = await import("../src/lib/autopilot-explain.ts");

const sug = (o: Record<string, unknown> = {}) => ({
  key: "t|2026-10-26", typeId: "t", typeName: "Doppia", structureId: "s", iso: "2026-10-26",
  base: 100, current: 100, suggested: 112, deltaPct: 12, occ: 85, rawSuggested: 112, reasons: [],
  signals: { occBand: "alta", weekend: false, lastMinute: false, gap: false, zoneReasons: [] }, ...o,
});

test("la data nella spiegazione ha giorno, mese e anno (gg.mm.aaaa), non solo 'lunedì 26'", () => {
  const t = explainSuggestion(sug() as never);
  assert.match(t, /lunedì 26\.10\.2026/);
  assert.doesNotMatch(t, /lunedì 26 /);
});
