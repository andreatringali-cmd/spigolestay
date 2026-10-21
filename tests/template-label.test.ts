import { test } from "node:test";
import assert from "node:assert/strict";
import { templateLabel, ensureMandatoryPerStructure, MANDATORY_TEMPLATES, restoreApprovedTexts } from "../src/lib/msg-templates.ts";

// I nomi tecnici dei modelli («checkin_online», «benvenuto_guida») non devono comparire nelle schermate; i dati salvati non cambiano.

test("nomi tecnici noti → etichetta leggibile", () => {
  assert.equal(templateLabel("checkin_online"), "Richiesta check-in online");
  assert.equal(templateLabel("benvenuto_guida"), "Benvenuto e guida");
});

test("nome tecnico non in elenco → parole separate; nomi normali restano com'erano", () => {
  assert.equal(templateLabel("promemoria_arrivo_tardi"), "Promemoria arrivo tardi");
  assert.equal(templateLabel("Benvenuto e guida"), "Benvenuto e guida");
  assert.equal(templateLabel("Check-in online"), "Check-in online");
  assert.equal(templateLabel("  Pagamento "), "Pagamento");
  assert.equal(templateLabel(""), "");
  assert.equal(templateLabel(undefined), "");
  assert.equal(templateLabel(null), "");
});

test("struttura NUOVA: nascono tutti e 5 i modelli obbligatori, con nome leggibile e testo", () => {
  const out = ensureMandatoryPerStructure<{ id: string; name: string; srcId?: string; structureIds?: string[]; texts: Record<string, string> }>([], ["aaaa1111-0000"]);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((t) => t.srcId).sort(), ["checkout", "guida", "pay", "selfcheckin", "tax"]);
  for (const t of out) {
    assert.deepEqual(t.structureIds, ["aaaa1111-0000"]);
    assert.ok(t.name.trim().length > 0 && !/_/.test(t.name), `nome leggibile: ${t.name}`);
    assert.equal(templateLabel(t.name), t.name); // già leggibile: l'etichetta non lo cambia
    for (const l of ["it", "en", "fr", "de", "es"]) assert.ok(t.texts[l]?.trim().length > 0, `${t.name} ${l}`);
  }
  assert.equal(out.find((t) => t.srcId === "selfcheckin")!.name, "Richiesta check-in online");
  assert.equal(out.find((t) => t.srcId === "guida")!.name, "Benvenuto e guida");
  assert.match(out.find((t) => t.srcId === "selfcheckin")!.texts.it, /\{link_checkin\}/);
  assert.match(out.find((t) => t.srcId === "guida")!.texts.it, /\{link_guida\}/);
});

test("i testi di partenza dei due modelli aggiunti passano subito ai testi approvati; la seconda volta non cambia nulla", () => {
  const out = ensureMandatoryPerStructure<{ id: string; srcId?: string; structureIds?: string[]; texts: Record<string, string> }>([], ["bbbb2222-0000"]);
  assert.match(out.find((t) => t.srcId === "selfcheckin")!.texts.it, /la legge italiana ci impone/);
  assert.match(out.find((t) => t.srcId === "guida")!.texts.it, /Lo staff vi augura buon soggiorno/);
  assert.deepEqual(restoreApprovedTexts(out), out);
  const again = ensureMandatoryPerStructure(out, ["bbbb2222-0000"]);
  assert.equal(again.length, 5); // niente doppioni
});

test("i modelli obbligatori nascono spenti (nessun invio automatico non voluto) e sono 5", () => {
  assert.equal(MANDATORY_TEMPLATES.length, 5);
  assert.ok(MANDATORY_TEMPLATES.every((m) => m.active === false));
});
