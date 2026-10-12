import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// pricing.ts legge le regole prezzo da localStorage (via publicdata/bigstore): lo si simula come in booking-commissioni.test.ts.
register("./helpers/alias-loader.mjs", import.meta.url);
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(), key: () => null, length: 0,
} as Storage;

const P = await import("../src/lib/pricing.ts");
const { effectiveBase, effBase, effectiveMinStay, effectiveClosed, isWeekendISO, rateForDay, parseWeekendRules, weekendPctFromRaw, weekendOnFromRaw, loadWeekendPct, loadWeekendOn, structureWeekendPct } = P;

const RULES = "spigolestay:pricerules";
const setRules = (v: unknown) => store.set(RULES, typeof v === "string" ? v : JSON.stringify(v));
const reset = () => store.clear();

// Giorni di giugno 2026: 12 = venerdi', 13 = sabato, 14 = domenica, 15 = lunedi'.
const VEN = "2026-06-12", SAB = "2026-06-13", DOM = "2026-06-14", LUN = "2026-06-15";
type RT = { id: string; structureId: string; name: string; beds: number; basePrice: number; [k: string]: unknown };
const rt = (id: string, basePrice: number, extra: Record<string, unknown> = {}): RT => ({ id, structureId: "S1", name: id, beds: 2, basePrice, ...extra });

// ───────────────────────── isWeekendISO ─────────────────────────
test("isWeekendISO: sabato e domenica si, venerdi' e lunedi' no", () => {
  assert.equal(isWeekendISO(VEN), false);
  assert.equal(isWeekendISO(SAB), true);
  assert.equal(isWeekendISO(DOM), true);
  assert.equal(isWeekendISO(LUN), false);
});

// ───────────────────────── effectiveBase / derivazione ─────────────────────────
test("effectiveBase: tipologia indipendente = prezzo di listino; alias effBase uguale", () => {
  const all = [rt("A", 100)];
  assert.equal(effectiveBase(all[0] as never, all as never), 100);
  assert.equal(effBase, effectiveBase);
});

test("effectiveBase: derivata in percentuale e in euro, con segno", () => {
  const all = [rt("A", 100), rt("B", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: 20 }), rt("C", 0, { deriveFrom: "A", deriveMode: "amount", deriveValue: -15 }), rt("D", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: -10 })];
  const e = (id: string) => effectiveBase(all.find((x) => x.id === id) as never, all as never);
  assert.equal(e("B"), 120);
  assert.equal(e("C"), 85);
  assert.equal(e("D"), 90);
});

test("effectiveBase: modalita' mancante = importo fisso; valore mancante = 0 (stessa tariffa della madre)", () => {
  const all = [rt("A", 100), rt("B", 0, { deriveFrom: "A", deriveValue: 25 }), rt("C", 0, { deriveFrom: "A" })];
  assert.equal(effectiveBase(all[1] as never, all as never), 125);
  assert.equal(effectiveBase(all[2] as never, all as never), 100);
});

test("effectiveBase: arrotondamento di default, esatto con deriveRound=false", () => {
  const all = [rt("A", 99), rt("B", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: 10 }), rt("C", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: 10, deriveRound: false })];
  assert.equal(effectiveBase(all[1] as never, all as never), 109); // 108,9
  assert.ok(Math.abs(effectiveBase(all[2] as never, all as never) - 108.9) < 1e-9);
});

test("effectiveBase: mai sotto zero", () => {
  const all = [rt("A", 50), rt("B", 0, { deriveFrom: "A", deriveMode: "amount", deriveValue: -200 }), rt("C", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: -300 })];
  assert.equal(effectiveBase(all[1] as never, all as never), 0);
  assert.equal(effectiveBase(all[2] as never, all as never), 0);
});

test("effectiveBase: catena A -> B -> C, e madre inesistente = prezzo proprio", () => {
  const all = [rt("A", 100), rt("B", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: 50 }), rt("C", 0, { deriveFrom: "B", deriveMode: "amount", deriveValue: 10 }), rt("X", 77, { deriveFrom: "non-esiste", deriveValue: 5 })];
  assert.equal(effectiveBase(all[2] as never, all as never), 160);
  assert.equal(effectiveBase(all[3] as never, all as never), 77);
});

test("effectiveBase: un ciclo (A deriva da B e B da A) non si blocca e da' un numero finito", () => {
  const all = [rt("A", 100, { deriveFrom: "B", deriveMode: "amount", deriveValue: 10 }), rt("B", 200, { deriveFrom: "A", deriveMode: "amount", deriveValue: 10 })];
  const a = effectiveBase(all[0] as never, all as never);
  const b = effectiveBase(all[1] as never, all as never);
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0);
});

test("effectiveMinStay / effectiveClosed: ereditano dalla madre solo con deriveInherit, a catena", () => {
  const all = [
    rt("A", 100, { minStay: 3, salesClosed: true }),
    rt("B", 0, { deriveFrom: "A", deriveInherit: true, minStay: 1 }),
    rt("C", 0, { deriveFrom: "B", deriveInherit: true }),
    rt("D", 0, { deriveFrom: "A", minStay: 2 }),
  ];
  const f = (id: string) => all.find((x) => x.id === id) as never;
  assert.equal(effectiveMinStay(f("B"), all as never), 3);
  assert.equal(effectiveMinStay(f("C"), all as never), 3);
  assert.equal(effectiveMinStay(f("D"), all as never), 2); // senza eredita' vale il proprio
  assert.equal(effectiveMinStay(f("A"), all as never), 3);
  assert.equal(effectiveClosed(f("C"), all as never), true);
  assert.equal(effectiveClosed(f("D"), all as never), false);
  assert.equal(effectiveMinStay(rt("Z", 1) as never, [] as never), 0);
});

// ───────────────────────── rateForDay ─────────────────────────
test("rateForDay: prezzo base nei giorni feriali, maggiorazione weekend del 25% di default", () => {
  reset();
  const all = [rt("A", 100)] as never[];
  assert.equal(rateForDay("A", VEN, all), 100);
  assert.equal(rateForDay("A", LUN, all), 100);
  assert.equal(rateForDay("A", SAB, all), 125);
  assert.equal(rateForDay("A", DOM, all), 125);
});

test("rateForDay: percentuale weekend passata dal chiamante (0 = nessuna maggiorazione) e arrotondamento", () => {
  reset();
  const all = [rt("A", 100), rt("B", 90), rt("C", 99)] as never[];
  assert.equal(rateForDay("A", SAB, all, {}, 0), 100);
  assert.equal(rateForDay("A", SAB, all, {}, 40), 140);
  assert.equal(rateForDay("B", SAB, all, {}, 25), 113); // 112,5 arrotonda per eccesso
  assert.equal(rateForDay("C", SAB, all, {}, 25), 124); // 123,75
  assert.equal(rateForDay("C", SAB, all, {}, 10), 109); // 108,9
});

test("rateForDay: tipologia inesistente = 0; listino a zero = 0", () => {
  reset();
  assert.equal(rateForDay("nope", VEN, [rt("A", 100)] as never[]), 0);
  assert.equal(rateForDay("A", SAB, [rt("A", 0)] as never[]), 0);
});

test("rateForDay: override per tipologia e giorno vince su tutto, anche sul weekend (nessuna maggiorazione sopra)", () => {
  reset();
  const all = [rt("A", 100)] as never[];
  assert.equal(rateForDay("A", SAB, all, { [`A|${SAB}`]: 200 }), 200);
  assert.equal(rateForDay("A", VEN, all, { [`A|${SAB}`]: 200 }), 100); // altro giorno: nessun effetto
});

test("rateForDay: override valido per tutte le tipologie in un giorno; quello per tipologia ha la precedenza", () => {
  reset();
  const all = [rt("A", 100), rt("B", 150)] as never[];
  const ov = { [VEN]: 80, [`B|${VEN}`]: 95 };
  assert.equal(rateForDay("A", VEN, all, ov), 80);
  assert.equal(rateForDay("B", VEN, all, ov), 95);
});

test("rateForDay: override arrotondati, 0 ammesso (omaggio/chiuso), negativi portati a 0", () => {
  reset();
  const all = [rt("A", 100)] as never[];
  assert.equal(rateForDay("A", VEN, all, { [VEN]: 99.5 }), 100);
  assert.equal(rateForDay("A", VEN, all, { [VEN]: 99.4 }), 99);
  assert.equal(rateForDay("A", VEN, all, { [VEN]: 0 }), 0);
  assert.equal(rateForDay("A", VEN, all, { [VEN]: -30 }), 0);
});

test("rateForDay: la derivata segue il prezzo GIORNALIERO della madre (weekend compreso), con la propria regola", () => {
  reset();
  const all = [rt("A", 100), rt("B", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: 20 }), rt("C", 0, { deriveFrom: "A", deriveMode: "amount", deriveValue: -10 })] as never[];
  assert.equal(rateForDay("B", VEN, all), 120);
  assert.equal(rateForDay("B", SAB, all), 150); // madre 125 +20%: il weekend NON si applica due volte
  assert.equal(rateForDay("C", SAB, all), 115);
});

test("rateForDay: un override sulla madre si propaga alle derivate; un override sulla derivata vince sulla madre", () => {
  reset();
  const all = [rt("A", 100), rt("B", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: 10 })] as never[];
  assert.equal(rateForDay("B", VEN, all, { [`A|${VEN}`]: 200 }), 220);
  assert.equal(rateForDay("B", VEN, all, { [`A|${VEN}`]: 200, [`B|${VEN}`]: 150 }), 150);
});

test("rateForDay: derivata a catena, arrotondamento esatto opzionale e mai negativa", () => {
  reset();
  const all = [
    rt("A", 99), rt("B", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: 10 }),
    rt("C", 0, { deriveFrom: "B", deriveMode: "amount", deriveValue: 5 }), rt("D", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: 10, deriveRound: false }),
    rt("E", 0, { deriveFrom: "A", deriveMode: "amount", deriveValue: -500 }),
  ] as never[];
  assert.equal(rateForDay("B", VEN, all), 109);
  assert.equal(rateForDay("C", VEN, all), 114);
  assert.ok(Math.abs(rateForDay("D", VEN, all) - 108.9) < 1e-9);
  assert.equal(rateForDay("E", VEN, all), 0);
});

test("rateForDay: cicli di derivazione non vanno in loop", () => {
  reset();
  const all = [rt("A", 100, { deriveFrom: "B", deriveMode: "amount", deriveValue: 10 }), rt("B", 200, { deriveFrom: "A", deriveMode: "amount", deriveValue: 10 })] as never[];
  const a = rateForDay("A", VEN, all), b = rateForDay("B", VEN, all);
  assert.ok(Number.isFinite(a) && a >= 0 && Number.isFinite(b) && b >= 0);
});

test("rateForDay: derivata con madre inesistente usa il proprio listino + weekend", () => {
  reset();
  const all = [rt("B", 100, { deriveFrom: "sparita", deriveMode: "percent", deriveValue: 50 })] as never[];
  assert.equal(rateForDay("B", VEN, all), 100);
  assert.equal(rateForDay("B", SAB, all), 125);
});

// ───────────────────────── regole weekend (per struttura) ─────────────────────────
test("parseWeekendRules: input mancante o rotto -> regole vuote; byStructure non oggetto ignorato", () => {
  assert.deepEqual(parseWeekendRules(null), { def: {}, byStructure: {} });
  assert.deepEqual(parseWeekendRules(""), { def: {}, byStructure: {} });
  assert.deepEqual(parseWeekendRules("{rotto"), { def: {}, byStructure: {} });
  assert.deepEqual(parseWeekendRules(JSON.stringify({ weekendOn: true, weekendPct: 30, byStructure: "no" })), { def: { weekendOn: true, weekendPct: 30 }, byStructure: {} });
});

test("weekendPctFromRaw: default 25, interruttore spento = 0, percentuale propria, 0 esplicito resta 0", () => {
  assert.equal(weekendPctFromRaw(null), 25);
  assert.equal(weekendPctFromRaw(JSON.stringify({ weekendOn: false, weekendPct: 40 })), 0);
  assert.equal(weekendPctFromRaw(JSON.stringify({ weekendPct: 40 })), 40);
  assert.equal(weekendPctFromRaw(JSON.stringify({ weekendOn: true, weekendPct: 0 })), 0);
  assert.equal(weekendPctFromRaw("{rotto"), 25);
});

test("weekendPctFromRaw per struttura: voce propria, campi mancanti dal default, altre strutture sul default", () => {
  const raw = JSON.stringify({ weekendOn: true, weekendPct: 30, byStructure: { S1: { weekendPct: 50 }, S2: { weekendOn: false }, S3: {} } });
  assert.equal(weekendPctFromRaw(raw, "S1"), 50);
  assert.equal(weekendPctFromRaw(raw, "S2"), 0); // spenta solo per S2
  assert.equal(weekendPctFromRaw(raw, "S3"), 30); // voce vuota: tutto dal default
  assert.equal(weekendPctFromRaw(raw, "S9"), 30);
  assert.equal(weekendPctFromRaw(raw), 30);
});

test("weekendPctFromRaw: se il default e' spento, una struttura con solo la percentuale eredita 'spento'", () => {
  const raw = JSON.stringify({ weekendOn: false, byStructure: { S1: { weekendPct: 50 }, S2: { weekendOn: true, weekendPct: 50 } } });
  assert.equal(weekendPctFromRaw(raw, "S1"), 0);
  assert.equal(weekendPctFromRaw(raw, "S2"), 50);
  assert.equal(weekendOnFromRaw(raw, "S1"), false);
  assert.equal(weekendOnFromRaw(raw, "S2"), true);
});

test("weekendOnFromRaw: acceso di default, spento solo se esplicitamente false", () => {
  assert.equal(weekendOnFromRaw(null), true);
  assert.equal(weekendOnFromRaw(JSON.stringify({ weekendOn: false })), false);
  assert.equal(weekendOnFromRaw(JSON.stringify({ weekendOn: false, byStructure: { S1: { weekendOn: true } } }), "S1"), true);
  assert.equal(weekendOnFromRaw(JSON.stringify({ byStructure: { S1: { weekendOn: false } } }), "S1"), false);
  assert.equal(weekendOnFromRaw(JSON.stringify({ byStructure: { S1: { weekendOn: false } } }), "S2"), true);
});

test("loadWeekendPct / loadWeekendOn: leggono le regole salvate nel browser", () => {
  reset();
  assert.equal(loadWeekendPct(), 25);
  assert.equal(loadWeekendOn(), true);
  setRules({ weekendOn: true, weekendPct: 35, byStructure: { S1: { weekendPct: 10 } } });
  assert.equal(loadWeekendPct(), 35);
  assert.equal(loadWeekendPct("S1"), 10);
  setRules({ weekendOn: false });
  assert.equal(loadWeekendPct(), 0);
  assert.equal(loadWeekendOn(), false);
  reset();
});

test("structureWeekendPct: senza struttura o senza voce propria vale il valore del chiamante; con voce propria, la voce", () => {
  reset();
  assert.equal(structureWeekendPct(undefined, 17), 17);
  assert.equal(structureWeekendPct("S1", 17), 17);
  setRules({ byStructure: { S1: { weekendPct: 60 } } });
  assert.equal(structureWeekendPct("S1", 17), 60);
  assert.equal(structureWeekendPct("S2", 17), 17);
  setRules({ byStructure: { S1: { weekendOn: false } } });
  assert.equal(structureWeekendPct("S1", 17), 0); // la cache si aggiorna quando cambia la stringa
  reset();
});

test("rateForDay: la regola weekend della struttura della tipologia batte la percentuale passata", () => {
  reset();
  setRules({ weekendPct: 25, byStructure: { S1: { weekendPct: 50 }, S2: { weekendOn: false } } });
  const all = [rt("A", 100), rt("B", 100, { structureId: "S2" }), rt("C", 100, { structureId: "S3" })] as never[];
  assert.equal(rateForDay("A", SAB, all, {}, 25), 150);
  assert.equal(rateForDay("B", SAB, all, {}, 25), 100);
  assert.equal(rateForDay("C", SAB, all, {}, 25), 125);
  assert.equal(rateForDay("A", VEN, all, {}, 25), 100); // feriale: nessuna maggiorazione
  reset();
});
