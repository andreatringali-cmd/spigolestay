import { test } from "node:test";
import assert from "node:assert/strict";
import { guestKey, normName, normPhone, isNameKey } from "../src/lib/guest-key.ts";

test("normName: maiuscole, accenti e spazi non contano", () => {
  assert.equal(normName("  José   Müller "), "jose muller");
  assert.equal(normName("Dajnowska Martyna"), normName("dajnowska  MARTYNA"));
});

test("normPhone: ignora prefisso internazionale e zero iniziale", () => {
  assert.equal(normPhone("+39 329 123 4567"), normPhone("0039 3291234567"));
  assert.equal(normPhone("12345"), ""); // troppo corto: non è un contatto affidabile
});

test("chiave: l'email vince, poi il telefono, poi nome+paese", () => {
  assert.equal(guestKey({ fullName: "A B", email: "X@Y.it" }), "e:x@y.it");
  assert.equal(guestKey({ fullName: "A B", phone: "+39 329 123 4567" }), "t:291234567".replace("t:291234567", "t:" + normPhone("+39 329 123 4567")));
  assert.equal(guestKey({ fullName: "Franzo Sonia", country: "IT" }), "n:franzo sonia|it");
  assert.equal(isNameKey(guestKey({ fullName: "Franzo Sonia" })), true);
  assert.equal(isNameKey(guestKey({ fullName: "Franzo Sonia", email: "a@b.it" })), false);
});

test("stesso nome ma paese diverso = persone diverse", () => {
  assert.notEqual(guestKey({ fullName: "Marco Rossi", country: "IT" }), guestKey({ fullName: "Marco Rossi", country: "DE" }));
});

test("nomi generici o troppo corti non si uniscono mai", () => {
  assert.equal(guestKey({ fullName: "Ospite" }), null);
  assert.equal(guestKey({ fullName: "Ospite (da ICS)" }), null);
  assert.equal(guestKey({ fullName: "Non disponibile" }), null);
  assert.equal(guestKey({ fullName: "Li" }), null);
  assert.equal(guestKey({ fullName: "" }), null);
});

test("ricerca per parole: 'luigi rotondo' trova 'Rotondo Luigi' (l'ordine non conta)", () => {
  const hay = normName("Rotondo Luigi luigi@x.it IT");
  const match = (q: string) => normName(q).split(" ").filter(Boolean).every((tk) => hay.includes(tk));
  assert.equal(match("luigi rotondo"), true);
  assert.equal(match("Rotondo   LUIGI"), true);
  assert.equal(match("rot lui"), true);      // anche pezzi di parola
  assert.equal(match("luigi bianchi"), false);
  assert.equal(match("  "), true);           // nessun testo = nessun filtro
});
