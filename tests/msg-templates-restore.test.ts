import test from "node:test";
import assert from "node:assert/strict";
import { restoreApprovedTexts, MANDATORY_TEMPLATES, ensureMandatoryPerStructure } from "../src/lib/msg-templates.ts";

type T = { id: string; texts: Record<string, string>; structureIds?: string[]; srcId?: string };
const pay = MANDATORY_TEMPLATES.find((m) => m.id === "mand-pay")!;

test("un modello obbligatorio col testo di partenza passa al testo approvato (anche le copie per struttura)", () => {
  const saved: T[] = [{ id: "mand-pay@7c476811", texts: { ...pay.texts } }, { id: "mand-pay", texts: { ...pay.texts } }];
  const out = restoreApprovedTexts(saved);
  for (const t of out) { assert.match(t.texts.it, /due modi/); assert.match(t.texts.it, /\{link_pagamento\}/); assert.equal(t.texts.en, pay.texts.en); } // le altre lingue non cambiano
});

test("un testo scritto dal titolare non si tocca", () => {
  const mine = "Il mio testo {importo} {link_pagamento}";
  const out = restoreApprovedTexts<T>([{ id: "mand-pay@abcd1234", texts: { ...pay.texts, it: mine } }]);
  assert.equal(out[0].texts.it, mine);
});

test("benvenuto_guida nel formato {{1}} (Meta) passa alla versione con i segnaposto di Xenora", () => {
  const old = "Buongiorno {{1}}, siamo lieti di accogliervi a {{2}}. Vi condividiamo la guida per accedere alla struttura e vivere al meglio il soggiorno, con check-in, Wi-Fi, consigli utili e contatti, a questo link: {{3}} Lo staff vi augura buon soggiorno!";
  const out = restoreApprovedTexts<T>([{ id: "seed-benvenuto-guida@767db967", texts: { it: old, en: "x" } }]);
  assert.match(out[0].texts.it, /\{link_guida\}/);
  assert.doesNotMatch(out[0].texts.it, /\{\{1\}\}/);
});

test("le strutture nuove ricevono i 3 modelli obbligatori già con i testi approvati; l'operazione è ripetibile", () => {
  const out = ensureMandatoryPerStructure<T>([], ["aaaa1111-0000"]);
  assert.equal(out.length, 3);
  assert.match(out.find((t) => t.id.startsWith("mand-checkout"))!.texts.it, /chiavi lasciale attaccate alla porta/);
  const again = restoreApprovedTexts(out);
  assert.deepEqual(again, out);
});
