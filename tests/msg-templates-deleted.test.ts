import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSeedTemplates, loadDeletedSeedIds, markSeedDeleted, DEFAULT_TEMPLATES } from "../src/lib/msg-templates.ts";

const saved = DEFAULT_TEMPLATES.filter((d) => d.id !== "seed-review").map((d) => ({ id: d.id, texts: { ...d.texts } as Record<string, string> }));

test("un modello d'esempio mancante viene rimesso (prima apertura)", () => {
  const m = mergeSeedTemplates(saved, [], true);
  assert.equal(m.length, DEFAULT_TEMPLATES.length);
  assert.ok(m.some((x) => x.id === "seed-review"));
});

test("un modello d'esempio eliminato (tombstone) non torna", () => {
  const m = mergeSeedTemplates(saved, ["seed-review"], true);
  assert.equal(m.length, DEFAULT_TEMPLATES.length - 1);
  assert.ok(!m.some((x) => x.id === "seed-review"));
});

test("un modello con l'id in tombstone ma presente tra i salvati resta", () => {
  const withIt = [...saved, { id: "seed-review", texts: { ...DEFAULT_TEMPLATES.find((d) => d.id === "seed-review")!.texts } as Record<string, string> }];
  const m = mergeSeedTemplates(withIt, ["seed-review"], true);
  assert.equal(m.filter((x) => x.id === "seed-review").length, 1);
});

test("senza localStorage (server/test) non ci sono tombstone e markSeedDeleted non rompe", () => {
  assert.deepEqual(loadDeletedSeedIds(), []);
  markSeedDeleted("seed-review");
  assert.deepEqual(loadDeletedSeedIds(), []);
});

test("modelli d'esempio spenti (default): non si aggiunge nulla da solo", () => {
  const saved = [{ id: "mio", name: "Il mio", texts: { it: "Ciao" } }];
  assert.deepEqual(mergeSeedTemplates(saved, []), saved);
});

test("modelli dei passaggi obbligatori: si aggiungono solo quelli mancanti (Pagamento, Tassa, Check-out)", async () => {
  const { ensureMandatoryTemplates } = await import("../src/lib/msg-templates.ts");
  const out = ensureMandatoryTemplates([{ srcId: "selfcheckin", id: "a" }, { srcId: "pay", id: "mio-pagamento" }] as any[]) as any[];
  assert.deepEqual(out.map((x) => x.srcId), ["selfcheckin", "pay", "tax", "checkout"]);
  assert.equal(out.find((x) => x.srcId === "pay").id, "mio-pagamento"); // il modello esistente non si tocca
  assert.ok(out.find((x) => x.srcId === "tax").texts.it.includes("{link_pagamento}"));
});
