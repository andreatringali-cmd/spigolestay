import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// puliziePlan.ts importa "@/lib/..." : li risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const { buildPuliziePlanText, buildPuliziePlanSummary } = await import("../src/lib/puliziePlan.ts");

const S = { id: "s1", name: "Spigolehouse" };
const unit = (n: string) => ({ id: `u${n}`, name: n });
const bk = (id: string, guestId: string, ci: string, co: string, adults = 2) => ({ id, guestId, checkIn: ci, checkOut: co, adults, children: 0 });
const guests = [{ id: "g1", fullName: "SUN HE" }, { id: "g2", fullName: "Karl Josef" }, { id: "g3", fullName: "Thomas Pies" }];
const room = (n: string, action: string, extra: Record<string, unknown> = {}) => ({ unit: unit(n), structure: S, typeName: "Std", oos: false, oosFrom: false, action, ...extra });
const rooms = [
  room("10", "riassetto", { stay: bk("b3", "g3", "2026-10-10", "2026-10-13", 1) }),
  room("2", "niente"),
  room("1", "turnover", { dep: bk("b1", "g1", "2026-10-09", "2026-10-11"), arr: bk("b2", "g2", "2026-10-11", "2026-10-13") }),
  room("3", "partenza", { dep: bk("b4", "g1", "2026-10-09", "2026-10-11") }),
  room("5", "niente", { oos: true, oosNote: "perdita d'acqua" }),
];
const args = { date: "2026-10-11", scopedStructures: [S], rooms, guests } as never;

test("il testo è ordinato per lavoro, con le camere in ordine naturale e le vuote in una riga", () => {
  const t = buildPuliziePlanText({ ...args, style: "plain" } as never);
  assert.ok(t.indexOf("CAMBIO COMPLETO") < t.indexOf("DOPO LA PARTENZA"));
  assert.ok(t.indexOf("DOPO LA PARTENZA") < t.indexOf("RIASSETTO"));
  assert.match(t, /• 1 — esce SUN HE · entra Karl Josef \(2 pers\., fino al 13\/10\)/);
  assert.match(t, /NIENTE DA FARE: 2/);
  assert.match(t, /FUORI SERVIZIO\n• 5 — perdita d'acqua/);
  assert.match(t, /3 camere da fare/);
});

test("stile email senza asterischi, stile WhatsApp con il grassetto", () => {
  assert.ok(!buildPuliziePlanText({ ...args, style: "plain" } as never).includes("*"));
  assert.ok(buildPuliziePlanText({ ...args, style: "whatsapp" } as never).includes("*Spigolehouse*"));
});

test("riepilogo di una riga per il modello WhatsApp: niente a capo, solo i numeri delle camere", () => {
  const s = buildPuliziePlanSummary(args as never);
  assert.ok(!s.includes("\n"));
  assert.match(s, /Spigolehouse — cambio completo: 1 \| partenza: 3 \| riassetto: 10 \| fuori servizio: 5 \| niente: 2/);
});

test("senza camere: messaggio chiaro", () => {
  assert.match(buildPuliziePlanSummary({ date: "2026-10-11", scopedStructures: [S], rooms: [] } as never), /Nessuna pulizia/);
  assert.match(buildPuliziePlanText({ date: "2026-10-11", scopedStructures: [S], rooms: [], guests: [] } as never), /Nessuna pulizia in programma/);
});

const { buildPuliziePlanFields } = await import("../src/lib/puliziePlan.ts");

test("campi per il modello WhatsApp a righe: una voce per lavoro, mai vuota, persone per cambi e arrivi", () => {
  const f = buildPuliziePlanFields(args as never);
  assert.equal(f.cambio, "1 (2 pers.)");
  assert.equal(f.arrivi, "nessuna");
  assert.equal(f.partenze, "3");
  assert.equal(f.riassetto, "10");
  assert.equal(f.fuori, "5");
  assert.equal(f.niente, "2");
  for (const v of Object.values(f)) assert.ok(v.length > 0 && !v.includes("\n"));
});

test("campi dettagliati: come il messaggio condiviso a mano (chi esce, chi entra, persone, fino a quando), una riga e mai vuoti", () => {
  const f = buildPuliziePlanFields({ ...(args as object), detailed: true } as never);
  assert.equal(f.cambio, "1 — esce SUN HE · entra Karl Josef (2 pers., fino al 13/10)");
  assert.equal(f.partenze, "3 — esce SUN HE");
  assert.equal(f.riassetto, "10 — Thomas Pies (1 pers., fino al 13/10)");
  assert.equal(f.fuori, "5 — perdita d'acqua");
  assert.equal(f.arrivi, "nessuna");
  for (const v of Object.values(f)) assert.ok(v.length > 0 && !/[\r\n\t]/.test(v) && !/ {5}/.test(v));
});

test("campi dettagliati: più camere dello stesso lavoro separate da punto e virgola", () => {
  const two = [...(rooms as unknown[]), room("4", "turnover", { dep: bk("b5", "g3", "2026-10-09", "2026-10-11"), arr: bk("b6", "g1", "2026-10-11", "2026-10-14") })];
  const f = buildPuliziePlanFields({ date: "2026-10-11", scopedStructures: [S], rooms: two, guests, detailed: true } as never);
  assert.equal(f.cambio.split("; ").length, 2);
  assert.match(f.cambio, /^1 — .*; 4 — esce Thomas Pies · entra SUN HE \(2 pers\., fino al 14\/10\)$/);
});
