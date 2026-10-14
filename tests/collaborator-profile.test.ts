import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { sanitizeProfile } = await import("../src/lib/user-access.ts");
const { mergeAdoptedProfile } = await import("../src/lib/adopt-profile.ts");

test("profilo inviato: solo campi noti, tipi e lunghezze controllati", () => {
  const p = sanitizeProfile({ id: "u-1", firstName: "Greta", lastName: "Vitale", phone: "+39 334 265 0167", templateKey: "owner", hack: "x", perms: { cassa: "edit", altro: "boh" }, allStructures: false, structureIds: ["s1", 5, "s2"] });
  assert.deepEqual(p, { id: "u-1", firstName: "Greta", lastName: "Vitale", phone: "+39 334 265 0167", templateKey: "owner", perms: { cassa: "edit" }, allStructures: false, structureIds: ["s1", "s2"] });
  assert.equal(sanitizeProfile(null), null);
  assert.equal(sanitizeProfile({ hack: 1 }), null);
  assert.equal((sanitizeProfile({ firstName: "x".repeat(500) })!.firstName as string).length, 80);
});

test("primo accesso: la scheda compilata dal titolare diventa la sua e sostituisce il segnaposto vuoto", () => {
  const placeholder = [{ id: "u-owner", email: "", firstName: "", lastName: "" }];
  const { list, id } = mergeAdoptedProfile(placeholder as never, { id: "u-greta", firstName: "Greta", lastName: "Vitale", phone: "+39 334 265 0167", username: "gretavitale", templateKey: "reception", perms: { cassa: "edit" }, allStructures: true }, "gretavitale29@gmail.com");
  assert.equal(id, "u-greta");
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].firstName, list[0].lastName, list[0].phone, list[0].username, list[0].email, list[0].status], ["Greta", "Vitale", "+39 334 265 0167", "gretavitale", "gretavitale29@gmail.com", "Attivo"]);
  assert.equal(list[0].templateKey, "reception");
});

test("accessi successivi: cambiano permessi e strutture (decide il titolare), non i dati personali che ha modificato lei", () => {
  const first = mergeAdoptedProfile(null, { id: "u-greta", firstName: "Greta", phone: "111", templateKey: "reception", allStructures: true }, "g@x.it");
  const edited = first.list.map((u) => ({ ...u, phone: "999 (suo)" }));
  const again = mergeAdoptedProfile(edited as never, { id: "u-greta", firstName: "Altro", phone: "000", templateKey: "cassa", allStructures: false, structureIds: ["s1"] }, "G@x.it");
  assert.equal(again.list.length, 1);
  assert.deepEqual([again.list[0].phone, again.list[0].firstName], ["999 (suo)", "Greta"]);
  assert.deepEqual([again.list[0].templateKey, again.list[0].allStructures, again.list[0].structureIds], ["cassa", false, ["s1"]]);
});
