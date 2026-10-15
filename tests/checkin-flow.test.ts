import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { checkinStatus, stepsWithMissing, needsMoreGuests, fieldId } = await import("../src/lib/checkin-flow.ts");

const full = { firstName: "Anna", lastName: "Bianchi", birthDate: "1990-05-01", docNumber: "AX123" };
const base = { doc: full, extras: [], photoFront: "data:x", consent: true, signature: "data:sig", isOperator: false, expectedGuests: 1, isGroup: false };

test("tutto compilato: si può inviare, nessun consiglio", () => {
  const r = checkinStatus(base);
  assert.equal(r.valid, true);
  assert.deepEqual(r.blocking, []);
  assert.deepEqual(r.advice, []);
});

test("caso reale: dati e documenti caricati ma consenso non spuntato → l'unico blocco è il consenso, al passo 3", () => {
  const r = checkinStatus({ ...base, consent: false });
  assert.equal(r.valid, false);
  assert.deepEqual(r.blocking, [{ code: "consent", step: 3, id: "f-consent" }]);
  assert.deepEqual([...stepsWithMissing(r.blocking)], [3]);
});

test("stessi requisiti di prima: nome, cognome, nascita, documento, consenso, firma (l'operatore non firma)", () => {
  const r = checkinStatus({ ...base, doc: { firstName: " ", lastName: "", birthDate: "", docNumber: "" }, consent: false, signature: undefined });
  assert.deepEqual(r.blocking.map((m) => m.code), ["firstName", "lastName", "birthDate", "docNumber", "consent", "signature"]);
  const op = checkinStatus({ ...base, isOperator: true, signature: undefined });
  assert.equal(op.valid, true);
  assert.equal(checkinStatus({ ...base, doc: null }).blocking.length, 4); // senza scheda mancano i 4 campi dell'ospite principale
});

test("la foto del documento non blocca (consiglio), a meno che REQUIRE sia attivo", () => {
  const r = checkinStatus({ ...base, photoFront: undefined, extras: [{ firstName: "Luca", lastName: "Bianchi" }], expectedGuests: 2 });
  assert.equal(r.valid, true);
  assert.deepEqual(r.advice, [{ code: "docPhoto", guest: 1 }, { code: "docPhoto", guest: 2 }]);
  const strict = checkinStatus({ ...base, photoFront: undefined, extras: [{ firstName: "Luca", lastName: "Bianchi" }], expectedGuests: 2, requireDocPhotos: true });
  assert.equal(strict.valid, false);
  assert.deepEqual(strict.blocking.map((m) => [m.code, m.step, m.id]), [["docPhoto", 2, "f-docPhoto-1"], ["docPhoto", 2, "f-docPhoto-2"]]);
});

test("meno ospiti del previsto: avviso (come prima, non blocca); ospite 2 con solo il nome: avviso", () => {
  const few = checkinStatus({ ...base, expectedGuests: 3, extras: [{ firstName: "Luca", lastName: "B", photoFront: "x" }] });
  assert.equal(few.valid, true);
  assert.equal(few.entered, 2);
  assert.deepEqual(few.advice, [{ code: "fewGuests", entered: 2, total: 3 }]);
  const partial = checkinStatus({ ...base, expectedGuests: 2, extras: [{ firstName: "Luca", lastName: "" }] });
  assert.deepEqual(partial.advice.map((a) => a.code), ["partialGuest", "fewGuests"]);
});

test("gruppo: ogni camera deve avere un ospite (blocco al passo 1); niente avviso 'meno ospiti'", () => {
  const r = checkinStatus({ ...base, isGroup: true, missingRooms: ["Doppia", "Suite"], expectedGuests: 5 });
  assert.deepEqual(r.blocking, [{ code: "group", step: 1, id: "f-group", rooms: ["Doppia", "Suite"] }]);
  assert.equal(r.advice.some((a) => a.code === "fewGuests"), false);
});

test("check-in già inviato: si riapre il modulo solo se mancano ospiti", () => {
  assert.equal(needsMoreGuests(2, 1), false);
  assert.equal(needsMoreGuests(3, 1), true);
  assert.equal(needsMoreGuests(1, 0), false);
  assert.equal(needsMoreGuests(0, 0), false);
});

test("id dei campi da evidenziare", () => {
  assert.equal(fieldId("firstName"), "f-firstName");
  assert.equal(fieldId("docPhoto", 3), "f-docPhoto-3");
});
