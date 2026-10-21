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

test("modelli dei passaggi obbligatori: si aggiungono solo quelli mancanti (Guida, Tassa, Check-out)", async () => {
  const { ensureMandatoryTemplates } = await import("../src/lib/msg-templates.ts");
  const out = ensureMandatoryTemplates([{ srcId: "selfcheckin", id: "a" }, { srcId: "pay", id: "mio-pagamento" }] as any[]) as any[];
  assert.deepEqual(out.map((x) => x.srcId), ["selfcheckin", "pay", "guida", "tax", "checkout"]);
  assert.equal(out.find((x) => x.srcId === "pay").id, "mio-pagamento"); // il modello esistente non si tocca
  assert.ok(out.find((x) => x.srcId === "tax").texts.it.includes("{link_pagamento}"));
});

test("ogni struttura è a sé: i modelli per tutte si dividono in una copia per struttura", async () => {
  const { splitTemplatesPerStructure, ensureMandatoryPerStructure } = await import("../src/lib/msg-templates.ts");
  const S = ["aaaaaaaa-1", "bbbbbbbb-2", "cccccccc-3"];
  const saved: any[] = [
    { id: "g", name: "Globale", srcId: "selfcheckin", texts: { it: "Ciao" } },
    { id: "uno", name: "Solo A", structureIds: ["aaaaaaaa-1"], texts: { it: "A" } },
    { id: "due", name: "A e B", structureIds: ["aaaaaaaa-1", "bbbbbbbb-2"], texts: { it: "AB" } },
  ];
  const out = splitTemplatesPerStructure(saved, S) as any[];
  assert.deepEqual(out.map((x) => [x.id, x.structureIds]), [
    ["g", ["aaaaaaaa-1"]], ["g@bbbbbbbb", ["bbbbbbbb-2"]], ["g@cccccccc", ["cccccccc-3"]],
    ["uno", ["aaaaaaaa-1"]],
    ["due", ["aaaaaaaa-1"]], ["due@bbbbbbbb", ["bbbbbbbb-2"]],
  ]);
  assert.equal(out[1].texts.it, "Ciao"); // stesso testo, ma ora indipendente
  assert.equal(splitTemplatesPerStructure(out, S).length, out.length); // già diviso: nessun cambiamento
  // modelli obbligatori: uno per passaggio e per struttura, senza duplicare quelli già collegati
  const full = ensureMandatoryPerStructure(out, S) as any[];
  for (const sid of S) assert.deepEqual(full.filter((x) => x.structureIds[0] === sid && (x.id.startsWith("mand-") || x.id.startsWith("seed-benvenuto"))).map((x) => x.srcId).sort(), ["checkout", "guida", "pay", "tax"]);
  assert.equal(full.filter((x) => x.srcId === "selfcheckin").length, 3); // già presenti, non si aggiunge
});

test("modelli eliminati dal titolare: tolti anche le copie per struttura, senza toccare quelli simili", async () => {
  const { dropRemovedTemplates } = await import("../src/lib/msg-templates.ts");
  const out = dropRemovedTemplates([{ id: "seed-welcome" }, { id: "seed-welcome@767db967" }, { id: "seed-checkin" }, { id: "seed-checkin-online" }, { id: "seed-review@ddc4ba98" }, { id: "seed-benvenuto-guida" }, { id: "mand-pay@7c476811" }]);
  assert.deepEqual(out.map((x) => x.id), ["seed-checkin-online", "seed-benvenuto-guida", "mand-pay@7c476811"]);
});
