import { test } from "node:test";
import assert from "node:assert/strict";
import { waTemplateFrom } from "../src/lib/wa-template.ts";

test("i segnaposto diventano variabili in ordine di apparizione; lo stesso segnaposto riusa lo stesso numero", () => {
  const d = waTemplateFrom("Buongiorno {ospite}, benvenuto a {struttura}! Ecco la guida: {link_guida}. A presto da {struttura}.");
  assert.equal(d.body, "Buongiorno {{1}}, benvenuto a {{2}}! Ecco la guida: {{3}}. A presto da {{2}}.");
  assert.deepEqual(d.tokens, ["ospite", "struttura", "link_guida"]);
  assert.equal(d.warnings.length, 0);
});

test("avvisi sulle regole di Meta: variabile all'inizio o alla fine, due variabili attaccate", () => {
  assert.match(waTemplateFrom("{ospite}, benvenuto a casa nostra, ti aspettiamo con piacere.").warnings.join(" "), /inizio/);
  assert.match(waTemplateFrom("Ecco la tua guida con tutte le informazioni utili: {link_guida}").warnings.join(" "), /fine/);
  assert.match(waTemplateFrom("Ciao a tutti, {nome}{cognome} benvenuti nella nostra struttura!").warnings.join(" "), /attaccate/);
});

test("senza segnaposto: nessuna variabile", () => {
  const d = waTemplateFrom("Grazie per aver soggiornato da noi, speriamo di rivedervi presto!");
  assert.deepEqual(d.tokens, []); assert.equal(d.body, "Grazie per aver soggiornato da noi, speriamo di rivedervi presto!");
});
