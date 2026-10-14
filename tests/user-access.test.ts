import test from "node:test";
import assert from "node:assert/strict";
import { signupLink, isValidEmail, humanInviteError, structuresToShare, permsForMember } from "../src/lib/user-access.ts";

test("link di registrazione con l'email già compilata", () => {
  assert.equal(signupLink("https://xenora.it/", "moglie@esempio.it"), "https://xenora.it/login?mode=signup&email=moglie%40esempio.it");
  assert.equal(signupLink("https://xenora.it", " A@b.it "), "https://xenora.it/login?mode=signup&email=A%40b.it");
});

test("email valida", () => {
  assert.equal(isValidEmail("a@b.it"), true);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail(""), false);
});

test("errori dell'invito: messaggi chiari", () => {
  assert.match(humanInviteError("email_not_registered"), /registrazione/);
  assert.match(humanInviteError("forbidden"), /titolare/);
  assert.equal(humanInviteError("boh", "Errore X"), "Errore X");
  assert.equal(humanInviteError(), "non riuscito");
});

test("strutture da condividere: tutte o solo quelle scelte", () => {
  const all = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(structuresToShare(all, { allStructures: true }), all);
  assert.deepEqual(structuresToShare(all, { allStructures: false, structureIds: ["b", "zzz"] }), [{ id: "b" }]);
  assert.deepEqual(structuresToShare(all, {}), []);
});

test("permessi del profilo: solo livelli noti", () => {
  assert.deepEqual(permsForMember({ cassa: "edit", prenotazioni: "view", x: "none", y: "boh" }), { cassa: "edit", prenotazioni: "view", x: "none" });
  assert.deepEqual(permsForMember(undefined), {});
});
