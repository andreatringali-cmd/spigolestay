import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestGuests, guestFormFields, splitFullName, guestDisplayName, fold } from "../src/lib/guest-suggest.ts";

const G = (id: string, lastName: string, firstName: string, extra: Record<string, string> = {}) => ({ id, lastName, firstName, fullName: `${firstName} ${lastName}`.trim(), ...extra }) as never;
const B = (guestId: string, status = "confirmed") => ({ guestId, status }) as never;

const guests = [
  G("1", "Rossi", "Mario", { email: "mario@x.it", phone: "+39 333 1" }),
  G("2", "Rossetti", "Anna"),
  G("3", "Bianchi", "Roberto"),
  G("4", "Nicolò", "Elena"),
  G("5", "De Luca", "Paolo"),
];
const bookings = [B("1"), B("1"), B("1", "cancelled"), B("2"), B("2"), B("2"), B("3")];

test("suggerimenti: già dalla prima lettera, sulle iniziali del cognome o del nome", () => {
  const r = suggestGuests(guests, bookings, "r", "").map((x) => x.g.id);
  assert.deepEqual(r.slice(0, 2).sort(), ["1", "2"], "Rossi e Rossetti (cognome che comincia con R) prima");
  assert.ok(r.includes("3"), "anche Roberto Bianchi: «r» e' l'inizio del nome");
  assert.ok(!r.includes("4") && !r.includes("5"));
});

test("suggerimenti: chi ha più soggiorni (non annullati) viene prima; gli annullati non contano", () => {
  const r = suggestGuests(guests, bookings, "ros", "");
  assert.deepEqual(r.map((x) => [x.g.id, x.n]), [["2", 3], ["1", 2]]);
});

test("suggerimenti: senza accenti né maiuscole, e le parole si combinano (cognome + nome)", () => {
  assert.deepEqual(suggestGuests(guests, bookings, "nicolo", "").map((x) => x.g.id), ["4"]);
  assert.deepEqual(suggestGuests(guests, bookings, "ROSSI", "mar").map((x) => x.g.id), ["1"]);
  assert.deepEqual(suggestGuests(guests, bookings, "luca", "").map((x) => x.g.id), ["5"], "cognome composto: «De Luca» si trova da «luca»");
});

test("suggerimenti: niente scritto = nessun suggerimento; nessuna corrispondenza = vuoto; limite", () => {
  assert.deepEqual(suggestGuests(guests, bookings, "", "  "), []);
  assert.deepEqual(suggestGuests(guests, bookings, "zz", ""), []);
  assert.equal(suggestGuests(guests, bookings, "r", "", 2).length, 2);
});

test("scegliendo un ospite si compilano insieme cognome, nome, email e telefono", () => {
  assert.deepEqual(guestFormFields(guests[0]), { lastName: "Rossi", firstName: "Mario", email: "mario@x.it", phone: "+39 333 1" });
  assert.equal(fold("Nicolò"), "nicolo");
});

test("ospiti senza cognome/nome separati (il 96% del registro): «Cognome Nome» si divide, mai tutto in un campo", () => {
  const f = (fullName: string) => guestFormFields({ id: "x", fullName } as never);
  assert.deepEqual(f("TRIDA EMANUELA"), { lastName: "Trida", firstName: "Emanuela", email: "", phone: "" }, "tutto maiuscolo → Trida Emanuela");
  assert.deepEqual(splitFullName("Tripoli Maria Rosa"), { lastName: "Tripoli", firstName: "Maria Rosa" });
  assert.deepEqual(splitFullName("TRIPOLI  GRAZIA"), { lastName: "Tripoli", firstName: "Grazia" }, "spazio doppio");
  assert.deepEqual(splitFullName("Donato Laura"), { lastName: "Donato", firstName: "Laura" }, "maiuscole già giuste: non si toccano");
  assert.deepEqual(splitFullName("De Filippis Mario"), { lastName: "De Filippis", firstName: "Mario" }, "la particella resta attaccata al cognome");
  assert.deepEqual(splitFullName("De Filippis"), { lastName: "De Filippis", firstName: "" });
  assert.deepEqual(splitFullName("Zarcone"), { lastName: "Zarcone", firstName: "" }, "una parola sola = cognome");
  assert.deepEqual(splitFullName("  "), { lastName: "", firstName: "" });
  assert.deepEqual(splitFullName("D'ANGELO MARIA-ROSA"), { lastName: "D'Angelo", firstName: "Maria-Rosa" });
});

test("se cognome e nome sono già salvati separati non si toccano; il nome da mostrare è «Cognome Nome»", () => {
  const g = { id: "1", fullName: "Mario Rossi", lastName: "ROSSI", firstName: "mario", email: "a@b.it" } as never;
  assert.deepEqual(guestFormFields(g), { lastName: "ROSSI", firstName: "mario", email: "a@b.it", phone: "" });
  assert.equal(guestDisplayName(g), "ROSSI mario");
  assert.equal(guestDisplayName({ id: "2", fullName: "TRIDA EMANUELA" } as never), "Trida Emanuela");
});
